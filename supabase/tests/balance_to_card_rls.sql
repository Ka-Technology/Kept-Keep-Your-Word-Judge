-- Proves sending a kept balance back to its card (migration 0080, T189's leftover): what came into Kept balance
-- from a return kept there (a stake or pledge of the person's own) can go back to the card it was paid from, up to
-- the balance there is now; a reward never can (it was other people's money, and waits for bank payouts, T190).
-- balance_cash_out() takes it out of the balance once per key, never more than a kept return still holds or the
-- balance has. Only the server moves it; the app reads how much it can send.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/balance_to_card_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A is the challenger; B, A's friend, pledges.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'to-card-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b1', 'to-card-b@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a1', 'tc_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000b1', 'tc_test_b', '1990-01-01', 'CA');
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', 'accepted', now());

do $$
begin
  if has_function_privilege('authenticated', 'public.balance_cash_out(uuid, uuid, integer, text)', 'execute')
     or has_function_privilege('authenticated', 'public.card_returnable(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.my_card_returnable()', 'execute')
     or has_function_privilege('anon', 'public.my_card_returnable()', 'execute') then
    raise exception 'FAIL: the wrong people can move or read a balance going back to a card';
  end if;
end $$;

-- A's $25 Cook by card is cancelled on Day 1; A's $20 Work out by card finishes with B's $30 pledge as a reward.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000a1', 'cook', 28, 2500, 'aspca', 'card', true, 'America/Los_Angeles', now()),
         ('00000000-0000-4000-8000-0000000000a1', 'workout', 28, 2000, 'aspca', 'card', true, 'America/Los_Angeles', now());
create temporary table ids on commit drop as select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a1';
grant select on ids to authenticated;
do $$
declare
  ch public.charges;
begin
  perform public.card_charge_succeeded(c.id, 'pi_tc_' || c.id) from public.charges c where c.challenge_id in (select id from ids);
  ch := public.pledge_charge('00000000-0000-4000-8000-0000000000b1', (select id from ids where habit_id = 'workout'), 3000, false, false);
  perform public.card_charge_succeeded(ch.id, 'pi_tc_pledge');
end $$;
update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now() where id = (select id from ids where habit_id = 'cook');
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() where id = (select id from ids where habit_id = 'workout');

-- As A: keep Cook's $25 in Kept. The balance is $55 ($25 kept, $30 reward); $25 of it can go back to a card.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select public.keep_in_balance((select id from public.my_money_back() where challenge_id = (select id from ids where habit_id = 'cook')));
do $$
begin
  if public.my_balance() <> 5500 or public.my_card_returnable() <> 2500 then
    raise exception 'FAIL: balance % with % returnable, not 5500 and 2500', public.my_balance(), public.my_card_returnable();
  end if;
end $$;
-- A spends $40 of it on a new stake: $15 is left, all of which can still go back.
insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, use_balance, time_zone, consented_at)
  values ('read', 28, 4000, 'aspca', 'card', true, true, 'America/Los_Angeles', now());
do $$
begin
  if public.my_balance() <> 1500 or public.my_card_returnable() <> 1500 then
    raise exception 'FAIL: after spending, balance % with % returnable', public.my_balance(), public.my_card_returnable();
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  kept uuid := (select id from public.payouts where challenge_id = (select id from ids where habit_id = 'cook') and source = 'stake');
begin
  if (select string_agg(source || ' ' || cents, ', ') from public.card_returnable('00000000-0000-4000-8000-0000000000a1')) is distinct from 'stake 2500' then
    raise exception 'FAIL: what can go back is %', (select string_agg(source || ' ' || cents, ', ') from public.card_returnable('00000000-0000-4000-8000-0000000000a1'));
  end if;
  -- More than the balance holds: refused.
  begin
    perform public.balance_cash_out('00000000-0000-4000-8000-0000000000a1', kept, 1600, 'k1');
    raise exception 'FAIL: more than the balance went back to a card';
  exception when raise_exception then
    if sqlerrm <> 'cash_out_too_much' then raise; end if;
  end;
  -- $15 goes back, once.
  perform public.balance_cash_out('00000000-0000-4000-8000-0000000000a1', kept, 1500, 'k2');
  perform public.balance_cash_out('00000000-0000-4000-8000-0000000000a1', kept, 1500, 'k2');
  if public.balance_cents('00000000-0000-4000-8000-0000000000a1') <> 0 then raise exception 'FAIL: a cash-out ran twice, or not at all'; end if;
  if (select cents from public.card_returnable('00000000-0000-4000-8000-0000000000a1')) <> 1000 then
    raise exception 'FAIL: the kept return doesn''t remember what already went back';
  end if;
  -- The reward can never go to a card.
  begin
    perform public.balance_cash_out('00000000-0000-4000-8000-0000000000a1',
      (select id from public.payouts where kind = 'reward' and challenge_id = (select id from ids where habit_id = 'workout')), 100, 'k3');
    raise exception 'FAIL: a reward went to a card';
  exception when raise_exception then
    if sqlerrm <> 'cash_out_too_much' then raise; end if;
  end;
end $$;

rollback;

select 'PASS: a kept return''s balance goes back to its card, up to what the balance has, once per key; a reward never does' as result;
