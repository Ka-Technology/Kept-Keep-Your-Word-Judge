-- Proves money nobody chooses for (migration 0067, T198, plan.md decision 158): a reward that real money backs
-- lands in Kept balance when the challenge ends, without waiting for a choice; a due, backed return nobody chose
-- for is due back to its card 14 days after it was due (unchosen_returns()), and send_back_unchosen() hands each
-- one to `payments` once, marking it 'sent'; a chosen return, a pretend one and a newer one are never touched.
-- payout_claim() is how `payments` takes the caller's own due return before refunding it. Only the server can
-- call these three.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/unchosen_money_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A is the challenger; B is A's friend who pledges.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a7', 'unchosen-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b7', 'unchosen-b@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a7', 'un_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000b7', 'un_test_b', '1990-01-01', 'CA');
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000a7', '00000000-0000-4000-8000-0000000000b7', 'accepted', now());

do $$
begin
  if has_function_privilege('authenticated', 'public.unchosen_returns()', 'execute')
     or has_function_privilege('authenticated', 'public.send_back_unchosen()', 'execute')
     or has_function_privilege('authenticated', 'public.payout_claim(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.rewards_to_balance(uuid)', 'execute') then
    raise exception 'FAIL: the app can call the server''s money functions';
  end if;
end $$;

-- By card, all paid: A's $25 Work out with B's $25 pledge (finishes), and A's $20 Cook with B's $10 pledge
-- (cancelled on Day 1). A's pretend $20 Read with no charge (cancelled too).
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000a7', 'workout', 28, 2500, 'aspca', 'card', true, 'America/Los_Angeles', now()),
         ('00000000-0000-4000-8000-0000000000a7', 'cook', 28, 2000, 'aspca', 'card', true, 'America/Los_Angeles', now());
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000a7', 'read', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now());
create temporary table ids on commit drop as
  select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a7';
grant select on ids to authenticated;

do $$
declare
  ch public.charges;
begin
  perform public.card_charge_succeeded((select id from public.charges where challenge_id = (select id from ids where habit_id = 'workout')), 'pi_un_stake_1');
  perform public.card_charge_succeeded((select id from public.charges where challenge_id = (select id from ids where habit_id = 'cook')), 'pi_un_stake_2');
  ch := public.pledge_charge('00000000-0000-4000-8000-0000000000b7', (select id from ids where habit_id = 'workout'), 2500, false, false);
  perform public.card_charge_succeeded(ch.id, 'pi_un_pledge_1');
  ch := public.pledge_charge('00000000-0000-4000-8000-0000000000b7', (select id from ids where habit_id = 'cook'), 1000, false, false);
  perform public.card_charge_succeeded(ch.id, 'pi_un_pledge_2');
end $$;
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now()
  where id = (select id from ids where habit_id = 'workout');
update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now()
  where id in (select id from ids where habit_id in ('cook', 'read'));

-- The reward is already A's balance; only the returns wait for a choice.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a7","role":"authenticated"}', true);
do $$
declare
  got text;
begin
  if public.my_balance() <> 2500 then raise exception 'FAIL: A''s reward isn''t in their balance (% there)', public.my_balance(); end if;
  select string_agg(kind || ' ' || source || ' ' || amount_cents, ', ' order by amount_cents) into got from public.my_money_back();
  if got is distinct from 'return stake 2000, return stake 2500' then raise exception 'FAIL: A''s money back is %', got; end if;
  if (select destination || ' ' || status from public.payouts where kind = 'reward') is distinct from 'balance paid' then
    raise exception 'FAIL: the reward payout isn''t marked as balance';
  end if;
end $$;

-- A keeps the Cook stake in Kept; then every payout is made 15 days old, but Cook's pledge return to B only 13.
select public.keep_in_balance((select id from public.my_money_back() where amount_cents = 2000));
reset role;
select set_config('request.jwt.claims', '', true);
update public.payouts set created_at = now() - interval '15 days'
  where challenge_id in (select id from ids);
update public.payouts set created_at = now() - interval '13 days'
  where challenge_id = (select id from ids where habit_id = 'cook') and source = 'pledge';

do $$
declare
  got text;
  claimed public.payouts;
begin
  -- Due back: only Work out's stake return to A. Not the kept one, the reward, Read's (pretend) or B's (13 days).
  select string_agg(o.source || ' ' || o.amount_cents || ' to ' || p.username, ', ' order by o.amount_cents) into got
    from public.unchosen_returns() o join public.profiles p on p.id = o.user_id;
  if got is distinct from 'stake 2500 to un_test_a' then raise exception 'FAIL: due back at 13 days are %', got; end if;

  -- A day later B's is due too.
  update public.payouts set created_at = now() - interval '15 days' where challenge_id = (select id from ids where habit_id = 'cook') and source = 'pledge';
  select string_agg(o.source || ' ' || o.amount_cents || ' to ' || p.username, ', ' order by o.amount_cents) into got
    from public.unchosen_returns() o join public.profiles p on p.id = o.user_id;
  if got is distinct from 'pledge 1000 to un_test_b, stake 2500 to un_test_a' then raise exception 'FAIL: due back are %', got; end if;

  -- Each is handed to payments once.
  if public.send_back_unchosen() <> 2 then raise exception 'FAIL: send_back_unchosen() didn''t send two'; end if;
  if public.send_back_unchosen() <> 0 then raise exception 'FAIL: send_back_unchosen() sent one twice'; end if;
  if (select string_agg(o.source || ' ' || o.status, ', ' order by o.source, o.status) from public.payouts o
      where o.challenge_id in (select id from ids) and o.kind = 'return' and o.status <> 'due') is distinct from 'pledge sent, stake paid, stake sent' then
    raise exception 'FAIL: the returns sent back aren''t marked, or the kept one changed';
  end if;
  if (select destination from public.payouts where challenge_id = (select id from ids where habit_id = 'cook') and source = 'stake') <> 'balance' then
    raise exception 'FAIL: the chosen return was touched';
  end if;

  -- payout_claim(): only the person's own due, backed return, once.
  update public.payouts set status = 'due' where challenge_id = (select id from ids where habit_id = 'workout') and kind = 'return';
  select * into claimed from public.payout_claim((select id from public.payouts where challenge_id = (select id from ids where habit_id = 'workout') and kind = 'return'),
                                                 '00000000-0000-4000-8000-0000000000b7');
  if claimed.id is not null then raise exception 'FAIL: B claimed A''s return'; end if;
  select * into claimed from public.payout_claim((select id from public.payouts where kind = 'reward' and challenge_id = (select id from ids where habit_id = 'workout')),
                                                 '00000000-0000-4000-8000-0000000000a7');
  if claimed.id is not null then raise exception 'FAIL: a reward was claimed to go back to a card'; end if;
  select * into claimed from public.payout_claim((select id from public.payouts where challenge_id = (select id from ids where habit_id = 'workout') and kind = 'return'),
                                                 '00000000-0000-4000-8000-0000000000a7');
  if claimed.status is distinct from 'sent' then raise exception 'FAIL: A couldn''t claim their own return'; end if;
  select * into claimed from public.payout_claim(claimed.id, '00000000-0000-4000-8000-0000000000a7');
  if claimed.id is not null then raise exception 'FAIL: a return was claimed twice'; end if;

  -- A sent payout finishes as paid; a return the person chose in the meantime can't be sent.
  perform public.payout_sent((select id from public.payouts where challenge_id = (select id from ids where habit_id = 'workout') and kind = 'return'), 'card');
  if (select status || ' ' || destination from public.payouts where challenge_id = (select id from ids where habit_id = 'workout') and kind = 'return')
     is distinct from 'paid card' then
    raise exception 'FAIL: a sent return wasn''t marked paid';
  end if;
end $$;

-- A pretend reward (no money behind it) stays out of the balance.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000a7', 'journal', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now());
insert into public.pledges (challenge_id, pledger_id, amount_cents, to_charity_on_finish)
  values ((select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a7' and habit_id = 'journal'),
          '00000000-0000-4000-8000-0000000000b7', 2000, false);
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now()
  where user_id = '00000000-0000-4000-8000-0000000000a7' and habit_id = 'journal';

do $$
begin
  if public.balance_cents('00000000-0000-4000-8000-0000000000a7') <> 4500 then
    raise exception 'FAIL: a pretend reward changed A''s balance (% now)', public.balance_cents('00000000-0000-4000-8000-0000000000a7');
  end if;
end $$;

rollback;

select 'PASS: rewards land in Kept balance, unchosen returns go back to their card after 14 days once, chosen and pretend ones never' as result;
