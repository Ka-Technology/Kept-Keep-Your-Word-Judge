-- Proves the 14-day wait on a reward (migration 0070, T195, plan.md decision 154): a reward's Kept balance entry
-- carries the date it can go to a bank, 14 days after its challenge ended; it can be spent at once; and
-- my_reward_waits() lists the caller's own rewards still inside their 14 days, less anything taken back (T194),
-- for Wallet and the results. The bank part itself comes with T190.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/reward_wait_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000aa', 'wait-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000ba', 'wait-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000ca', 'wait-c@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000aa', 'rw_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000ba', 'rw_test_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000ca', 'rw_test_c', '1990-01-01', 'TX');
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000ba', 'accepted', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000ca', 'accepted', now());

-- A's Work out by card, with B's $25 and C's $30 pledges, all paid; it finished two days ago.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000aa', 'workout', 28, 2500, 'aspca', 'card', true, 'America/Los_Angeles', now());
create temporary table ids on commit drop as
  select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000aa';
grant select on ids to authenticated;

do $$
declare
  ch public.charges;
begin
  perform public.card_charge_succeeded((select id from public.charges where challenge_id = (select id from ids)), 'pi_rw_stake');
  ch := public.pledge_charge('00000000-0000-4000-8000-0000000000ba', (select id from ids), 2500, false, false);
  perform public.card_charge_succeeded(ch.id, 'pi_rw_pledge_b');
  ch := public.pledge_charge('00000000-0000-4000-8000-0000000000ca', (select id from ids), 3000, false, false);
  perform public.card_charge_succeeded(ch.id, 'pi_rw_pledge_c');
end $$;
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() - interval '2 days' where id = (select id from ids);

do $$
begin
  if exists (
    select 1 from public.balance_entries e join public.payouts o on o.id = e.payout_id
    where o.challenge_id = (select id from ids) and o.kind = 'reward'
      and e.cashable_at is distinct from (now() - interval '2 days') + interval '14 days'
  ) or (select count(*) from public.balance_entries where cashable_at is not null) <> 2 then
    raise exception 'FAIL: a reward''s entry isn''t dated 14 days after its challenge ended';
  end if;
  -- A take-back of C's $30 (T194) leaves only B's $25 waiting.
  perform public.pledge_taken_back((select id from public.charges where user_id = '00000000-0000-4000-8000-0000000000ca'), 'dispute');
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);

do $$
declare
  got text;
begin
  select string_agg(habit || ' ' || amount_cents || ' ' || (cashable_at::date - current_date), ', ') into got from public.my_reward_waits();
  if got is distinct from 'Work out 2500 12' then raise exception 'FAIL: A''s rewards waiting are %', got; end if;
  if (select challenge_id from public.my_reward_waits()) is distinct from (select id from ids) then
    raise exception 'FAIL: a waiting reward doesn''t name its challenge';
  end if;
end $$;

-- Spendable at once: A's next stake is paid from the reward.
insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, use_balance, time_zone, consented_at)
  values ('read', 28, 2000, 'aspca', 'card', true, true, 'America/Los_Angeles', now());
reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if (select balance_cents from public.charges where user_id = '00000000-0000-4000-8000-0000000000aa' and status = 'pending') <> 2000 then
    raise exception 'FAIL: a reward in its 14 days couldn''t be spent';
  end if;
end $$;

-- B sees none of it; 15 days on, nothing waits.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000ba","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.my_reward_waits()) then raise exception 'FAIL: B sees A''s reward'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
update public.balance_entries set cashable_at = now() - interval '1 day' where cashable_at is not null;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.my_reward_waits()) then raise exception 'FAIL: a reward past its 14 days still waits'; end if;
end $$;

rollback;

select 'PASS: a reward''s entry can go to a bank 14 days after its challenge ended, spendable at once; my_reward_waits() lists own rewards still waiting, less take-backs' as result;
