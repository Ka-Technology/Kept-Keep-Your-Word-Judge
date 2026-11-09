-- Proves disputes and fraud warnings taken back (migration 0068, T194, plan.md decision 153): when a pledge's
-- card charge gets an early fraud warning or a dispute, pledge_taken_back() records it once and
--   - on a running challenge, withdraws the pledge (the warned charge's balance part goes back to its pledger);
--   - on a pledge that became a reward, takes the card part back from the finisher's Kept balance, as a keyed
--     'takeback' entry; what the balance can't cover is owed, so it comes out of their next reward;
--   - on a return still due, stops it, since the money already went back through the bank.
-- A balance below zero pays nothing. Only the server can call it.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/takeback_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A and D are challengers; B is a friend of both who pledges.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a8', 'takeback-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b8', 'takeback-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000d8', 'takeback-d@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a8', 'tb_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000b8', 'tb_test_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000d8', 'tb_test_d', '1990-01-01', 'TX');
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000a8', '00000000-0000-4000-8000-0000000000b8', 'accepted', now()),
  ('00000000-0000-4000-8000-0000000000d8', '00000000-0000-4000-8000-0000000000b8', 'accepted', now());

do $$
begin
  if has_function_privilege('authenticated', 'public.pledge_taken_back(uuid, text)', 'execute') then
    raise exception 'FAIL: the app can take a pledge back';
  end if;
end $$;

-- Paid challenges by card: A's Work out (finishes) and Read (runs), D's Cook (finishes), A's Journal (cancelled).
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000a8', 'workout', 28, 2500, 'aspca', 'card', true, 'America/Los_Angeles', now()),
         ('00000000-0000-4000-8000-0000000000a8', 'read', 28, 2000, 'aspca', 'card', true, 'America/Los_Angeles', now()),
         ('00000000-0000-4000-8000-0000000000a8', 'journal', 28, 2000, 'aspca', 'card', true, 'America/Los_Angeles', now()),
         ('00000000-0000-4000-8000-0000000000d8', 'cook', 28, 2000, 'aspca', 'card', true, 'America/Los_Angeles', now());
create temporary table ids on commit drop as
  select habit_id, id from public.challenges where user_id in ('00000000-0000-4000-8000-0000000000a8', '00000000-0000-4000-8000-0000000000d8');
grant select on ids to authenticated;

-- Every stake paid; B pledges $25 on each of A's three and on D's Cook, all paid by card.
create temporary table b_charges (habit_id text, charge uuid) on commit drop;
do $$
declare
  h text;
  ch public.charges;
begin
  perform public.card_charge_succeeded(c.id, 'pi_tb_stake_' || c.id) from public.charges c where c.challenge_id in (select id from ids);
  foreach h in array array['workout', 'read', 'journal', 'cook'] loop
    ch := public.pledge_charge('00000000-0000-4000-8000-0000000000b8', (select id from ids where habit_id = h), 2500, false, false);
    perform public.card_charge_succeeded(ch.id, 'pi_tb_pledge_' || h);
    insert into b_charges values (h, ch.id);
  end loop;
end $$;
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() where id in (select id from ids where habit_id in ('workout', 'cook'));
update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now() where id = (select id from ids where habit_id = 'journal');

-- A keeps Work out's stake in Kept.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a8","role":"authenticated"}', true);
select public.keep_in_balance((select id from public.my_money_back() where challenge_id = (select id from ids where habit_id = 'workout')));
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  what text;
  spent public.charges;
begin
  -- 1. A's reward from B ($25) is in A's balance, with A's kept stake ($25): the fraud warning takes $25 back.
  if public.balance_cents('00000000-0000-4000-8000-0000000000a8') <> 5000 then raise exception 'FAIL: A''s balance before is %', public.balance_cents('00000000-0000-4000-8000-0000000000a8'); end if;
  what := public.pledge_taken_back((select charge from b_charges where habit_id = 'workout'), 'fraud_warning');
  if what <> 'taken_back' then raise exception 'FAIL: a reward''s take-back answered %', what; end if;
  if public.balance_cents('00000000-0000-4000-8000-0000000000a8') <> 2500 then raise exception 'FAIL: A''s balance after is %', public.balance_cents('00000000-0000-4000-8000-0000000000a8'); end if;
  if (select count(*) from public.balance_entries where source = 'takeback' and key = 'takeback:' || (select charge from b_charges where habit_id = 'workout')) <> 1 then
    raise exception 'FAIL: the take-back isn''t one keyed entry';
  end if;
  -- The dispute that follows the warning changes nothing more.
  what := public.pledge_taken_back((select charge from b_charges where habit_id = 'workout'), 'dispute');
  if what <> 'already' or public.balance_cents('00000000-0000-4000-8000-0000000000a8') <> 2500 then raise exception 'FAIL: a charge was taken back twice'; end if;

  -- 2. D's $25 reward is spent on a new $25 stake paid from the balance; then B's pledge on Cook is disputed.
  insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, use_balance, time_zone, consented_at)
    values ('00000000-0000-4000-8000-0000000000d8', 'stretch', 28, 2500, 'aspca', 'card', true, true, 'America/Los_Angeles', now());
  select * into spent from public.charges where user_id = '00000000-0000-4000-8000-0000000000d8' and kind = 'stake' and status = 'pending';
  perform public.card_charge_succeeded(spent.id, null);
  if public.balance_cents('00000000-0000-4000-8000-0000000000d8') <> 0 then raise exception 'FAIL: D''s balance wasn''t spent'; end if;
  what := public.pledge_taken_back((select charge from b_charges where habit_id = 'cook'), 'dispute');
  if what <> 'taken_back' or public.balance_cents('00000000-0000-4000-8000-0000000000d8') <> -2500 then
    raise exception 'FAIL: D''s take-back answered % and left %', what, public.balance_cents('00000000-0000-4000-8000-0000000000d8');
  end if;
  -- Owed: a balance below zero pays nothing on D's next charge...
  insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, use_balance, time_zone, consented_at)
    values ('00000000-0000-4000-8000-0000000000d8', 'meditate', 28, 2000, 'aspca', 'card', true, true, 'America/Los_Angeles', now());
  if (select balance_cents from public.charges where user_id = '00000000-0000-4000-8000-0000000000d8' and kind = 'stake' and status = 'pending') <> 0 then
    raise exception 'FAIL: a balance below zero paid for a charge';
  end if;
end $$;

-- ...and D's next reward ($30 from B, on Stretch) pays it off first.
do $$
declare
  ch public.charges;
begin
  ch := public.pledge_charge('00000000-0000-4000-8000-0000000000b8',
    (select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000d8' and habit_id = 'stretch'), 3000, false, false);
  perform public.card_charge_succeeded(ch.id, 'pi_tb_pledge_stretch');
end $$;
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now()
  where user_id = '00000000-0000-4000-8000-0000000000d8' and habit_id = 'stretch';

do $$
declare
  what text;
begin
  if public.balance_cents('00000000-0000-4000-8000-0000000000d8') <> 500 then
    raise exception 'FAIL: D''s next reward didn''t pay off what was owed (% now)', public.balance_cents('00000000-0000-4000-8000-0000000000d8');
  end if;

  -- 3. A running challenge: B's pledge on Read is withdrawn.
  what := public.pledge_taken_back((select charge from b_charges where habit_id = 'read'), 'fraud_warning');
  if what <> 'withdrawn' then raise exception 'FAIL: a running challenge''s take-back answered %', what; end if;
  if exists (select 1 from public.pledges where challenge_id = (select id from ids where habit_id = 'read')) then
    raise exception 'FAIL: the pledge on a running challenge wasn''t withdrawn';
  end if;

  -- 4. A cancelled challenge: B's $25 return, still due, stops (the bank already gave it back).
  what := public.pledge_taken_back((select charge from b_charges where habit_id = 'journal'), 'dispute');
  if what <> 'stopped' or (select status from public.payouts where challenge_id = (select id from ids where habit_id = 'journal') and source = 'pledge') <> 'failed' then
    raise exception 'FAIL: a due return wasn''t stopped (answered %)', what;
  end if;

  -- A stake charge isn't a pledge: nothing happens (the owner handles it, docs/wiki/Money-Exceptions.md).
  what := public.pledge_taken_back((select id from public.charges where challenge_id = (select id from ids where habit_id = 'read') and kind = 'stake'), 'dispute');
  if what <> 'not_a_pledge' then raise exception 'FAIL: a stake charge answered %', what; end if;
end $$;

-- As A: the take-back shows in A's own ledger, and B sees none of it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a8","role":"authenticated"}', true);
do $$
begin
  if (select string_agg(habit || ' ' || amount_cents, ', ') from public.my_takebacks()) is distinct from 'Work out -2500' then
    raise exception 'FAIL: A''s take-backs are %', (select string_agg(habit || ' ' || amount_cents, ', ') from public.my_takebacks());
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b8","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.my_takebacks()) then raise exception 'FAIL: B sees a take-back'; end if;
end $$;

rollback;

select 'PASS: a disputed or warned pledge is withdrawn while running, taken back from the finisher''s balance (owed if spent), a due return stopped, once' as result;
