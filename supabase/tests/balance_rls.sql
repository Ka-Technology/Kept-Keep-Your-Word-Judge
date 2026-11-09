-- Proves Kept balance (migration 0063, T189, plan.md decision 145): money coming back that real money backs
-- waits for its owner's choice (my_money_back()); keep_in_balance() makes it balance, once, for its owner
-- only; the demo's pretend payouts can't be chosen. A balance pays the next charge first: all of it with no
-- fee, or part of it with the fee worked out on what the card pays; a failed charge gives its balance back;
-- the balance never goes below zero; only the server writes the ledger or marks a payout sent.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked --project-ref <ref> -f supabase/tests/balance_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A balance pays only a charge that asks for it (`use_balance`, 0064); credits come off the fee by themselves.
-- A is the challenger; B is A's friend who pledges.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a4', 'balance-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b4', 'balance-b@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a4', 'bl_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000b4', 'bl_test_b', '1990-01-01', 'CA');
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000b4', 'accepted', now());

do $$
begin
  if has_any_column_privilege('authenticated', 'public.balance_entries', 'insert')
     or has_any_column_privilege('authenticated', 'public.balance_entries', 'update')
     or has_table_privilege('authenticated', 'public.balance_entries', 'delete')
     or has_table_privilege('anon', 'public.balance_entries', 'select') then
    raise exception 'FAIL: the app can write the balance ledger, or anon can read it';
  end if;
  if has_function_privilege('authenticated', 'public.balance_credit(uuid, integer, text, text, uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.payout_sent(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.balance_cents(uuid)', 'execute') then
    raise exception 'FAIL: the app can move or read anyone''s balance';
  end if;
end $$;

-- A's $25 Work out by card, paid; B's $25 pledge on it, paid; A also has a pretend $20 Read. Both finish.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000a4', 'workout', 28, 2500, 'aspca', 'card', true, 'America/Los_Angeles', now());
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000a4', 'read', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now());
create temporary table ids on commit drop as
  select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a4';
grant select on ids to authenticated;

do $$
declare
  ch public.charges;
begin
  perform public.card_charge_succeeded((select id from public.charges where challenge_id = (select id from ids where habit_id = 'workout')), 'pi_test_stake');
  ch := public.pledge_charge('00000000-0000-4000-8000-0000000000b4', (select id from ids where habit_id = 'workout'), 2500, false, false);
  perform public.card_charge_succeeded(ch.id, 'pi_test_pledge');
end $$;
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now()
  where user_id = '00000000-0000-4000-8000-0000000000a4';

-- As A: the reward is already balance (0067); the stake back waits for a choice; the pretend Read's stake doesn't.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
do $$
declare
  got text;
begin
  select string_agg(kind || ' ' || source || ' ' || amount_cents, ', ' order by kind) into got from public.my_money_back();
  if got is distinct from 'return stake 2500' then raise exception 'FAIL: A''s money back is %', got; end if;
  if public.my_balance() <> 2500 then raise exception 'FAIL: A''s reward isn''t balance (% there)', public.my_balance(); end if;
  perform public.keep_in_balance((select id from public.my_money_back() where kind = 'return'));
  if public.my_balance() <> 5000 then raise exception 'FAIL: A''s balance is %, not 5000', public.my_balance(); end if;
  if exists (select 1 from public.my_money_back()) then raise exception 'FAIL: kept money still waits for a choice'; end if;
  if (select string_agg(destination || ' ' || status, ',') from public.payouts where challenge_id = (select id from ids where habit_id = 'workout'))
     is distinct from 'balance paid,balance paid' then
    raise exception 'FAIL: kept payouts aren''t marked';
  end if;
  -- Twice, or a pretend payout: refused.
  begin
    perform public.keep_in_balance((select id from public.payouts where challenge_id = (select id from ids where habit_id = 'workout') limit 1));
    raise exception 'FAIL: a payout was kept twice';
  exception when raise_exception then
    if sqlerrm <> 'payout_not_yours' then raise; end if;
  end;
  begin
    perform public.keep_in_balance((select id from public.payouts where challenge_id = (select id from ids where habit_id = 'read')));
    raise exception 'FAIL: a pretend payout became balance';
  exception when raise_exception then
    if sqlerrm <> 'payout_not_yours' then raise; end if;
  end;
end $$;

-- As B: nothing waits (B's pledge was A's reward), and A's payouts can't be kept by B.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b4","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.my_money_back()) or public.my_balance() <> 0 or exists (select 1 from public.balance_entries) then
    raise exception 'FAIL: B sees money back or a balance';
  end if;
end $$;

-- As A, with $50 in balance: a $35 Journal by card is paid whole by the balance, with no fee; a $30 Meditate
-- takes the last $15, and the card pays $15 plus the fee on $15 only.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, use_balance, time_zone, consented_at)
  values ('journal', 28, 3500, 'aspca', 'card', true, true, 'America/Los_Angeles', now());
insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, use_balance, time_zone, consented_at)
  values ('meditate', 28, 3000, 'aspca', 'card', true, true, 'America/Los_Angeles', now());
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  got text;
begin
  select string_agg(c.habit_id || ' ' || ch.balance_cents || '+card ' || (ch.amount_cents - ch.balance_cents) || ' fee ' || ch.fee_cents || ' = ' || ch.total_cents, ', ' order by c.habit_id)
    into got
    from public.charges ch join public.challenges c on c.id = ch.challenge_id
    where c.user_id = '00000000-0000-4000-8000-0000000000a4' and c.habit_id in ('journal', 'meditate');
  if got is distinct from 'journal 3500+card 0 fee 0 = 0, meditate 1500+card 1500 fee 195 = 1695' then
    raise exception 'FAIL: charges paid with balance are %', got;
  end if;
  if public.balance_cents('00000000-0000-4000-8000-0000000000a4') <> 0 then raise exception 'FAIL: the balance wasn''t spent'; end if;

  -- Meditate's card is declined: its $15 of balance comes back. The balance never went below zero.
  perform public.card_charge_failed((select ch.id from public.charges ch join public.challenges c on c.id = ch.challenge_id
                                     where c.user_id = '00000000-0000-4000-8000-0000000000a4' and c.habit_id = 'meditate'), 'Your card was declined.');
  if public.balance_cents('00000000-0000-4000-8000-0000000000a4') <> 1500 then
    raise exception 'FAIL: a declined charge kept its balance (% left)', public.balance_cents('00000000-0000-4000-8000-0000000000a4');
  end if;
  if exists (
    select 1 from public.balance_entries e1
    where e1.user_id = '00000000-0000-4000-8000-0000000000a4'
      and (select sum(e2.amount_cents) from public.balance_entries e2 where e2.user_id = e1.user_id and e2.created_at <= e1.created_at) < 0
  ) then
    raise exception 'FAIL: the balance went below zero';
  end if;

  -- A $20 Cook by card alone: the $15 balance stays put, and the card pays the stake and the whole fee.
  insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
    values ('00000000-0000-4000-8000-0000000000a4', 'cook', 28, 2000, 'aspca', 'card', true, 'America/Los_Angeles', now());
  if (select ch.balance_cents::text || ' ' || ch.total_cents from public.charges ch join public.challenges c on c.id = ch.challenge_id
      where c.user_id = '00000000-0000-4000-8000-0000000000a4' and c.habit_id = 'cook') is distinct from '0 2210'
     or public.balance_cents('00000000-0000-4000-8000-0000000000a4') <> 1500 then
    raise exception 'FAIL: a card charge took the balance without being asked';
  end if;

  -- The server marks a return sent to its card: it's no longer waiting.
  perform public.payout_sent((select id from public.payouts where challenge_id = (select id from ids where habit_id = 'read')), 'card');
  if (select destination || ' ' || status from public.payouts where challenge_id = (select id from ids where habit_id = 'read')) <> 'card paid' then
    raise exception 'FAIL: a payout sent to its card isn''t marked';
  end if;
end $$;

-- As A, with $15 of balance left: the account can't be deleted (0065); the balance is A's. The owner first ends
-- Cook (still running, which would block it as money still promised), so only the balance is left.
update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now()
  where user_id = '00000000-0000-4000-8000-0000000000a4' and outcome is null;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.delete_account();
    raise exception 'FAIL: an account with Kept balance was deleted';
  exception when raise_exception then
    if sqlerrm <> 'money_in_kept' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

rollback;

select 'PASS: backed money back waits for its owner, kept in balance once; pretend payouts can''t be; a balance pays a charge first (no fee on its part); a declined charge gives it back; never below zero; no deleting an account with balance; server-only writes' as result;
