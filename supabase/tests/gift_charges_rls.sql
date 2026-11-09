-- Proves extra gifts paid by card (migration 0079, T93's leftover; SPEC-pledges.md decision 11): a gift is checked
-- as its giver (check_gift(), every gift rule), charged for what it adds and no fee (gift_charge()), and counts
-- only once paid (card_charge_succeeded()); one that breaks a rule by then is refunded whole. The donation follows.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/gift_charges_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A is the challenger; B, A's friend, pledged; C is a stranger.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a2', 'gift-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b2', 'gift-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000c2', 'gift-c@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a2', 'gc_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000b2', 'gc_test_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000c2', 'gc_test_c', '1990-01-01', 'TX');
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000b2', 'accepted', now());
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
select '00000000-0000-4000-8000-0000000000a2', h, 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now() from unnest(array['read', 'journal']) h;
create temporary table ids on commit drop as select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a2';
grant select on ids to authenticated;
insert into public.pledges (challenge_id, pledger_id, amount_cents) values ((select id from ids where habit_id = 'read'), '00000000-0000-4000-8000-0000000000b2', 2000);
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() where id = (select id from ids where habit_id = 'read');

do $$
begin
  if has_function_privilege('authenticated', 'public.gift_charge(uuid, uuid, integer)', 'execute') then
    raise exception 'FAIL: the app can price its own gift charge';
  end if;
end $$;

-- As B: $10 checks out on the finished Read, not on the running Journal (B never pledged there either).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
select public.check_gift((select id from ids where habit_id = 'read'), 1000);
do $$
begin
  begin
    perform public.check_gift((select id from ids where habit_id = 'journal'), 1000);
    raise exception 'FAIL: a gift checked out on a running challenge';
  exception when raise_exception then
    if sqlerrm not in ('gift_not_allowed', 'gift_challenge_running') then raise; end if;
  end;
  if exists (select 1 from public.extra_gifts) then raise exception 'FAIL: checking a gift saved it'; end if;
end $$;
-- As C, a stranger: refused.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.check_gift((select id from ids where habit_id = 'read'), 1000);
    raise exception 'FAIL: a stranger''s gift checked out';
  exception when raise_exception then
    if sqlerrm <> 'gift_not_allowed' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  ch public.charges;
begin
  -- $10, no fee; paid, it counts, and goes to the charity.
  ch := public.gift_charge('00000000-0000-4000-8000-0000000000b2', (select id from ids where habit_id = 'read'), 1000);
  if ch.kind <> 'gift' or ch.amount_cents <> 1000 or ch.fee_cents <> 0 or ch.total_cents <> 1000 then raise exception 'FAIL: a gift charge is %', ch; end if;
  if exists (select 1 from public.extra_gifts) then raise exception 'FAIL: an unpaid gift counted'; end if;
  if public.card_charge_succeeded(ch.id, 'pi_gc_1') <> 'paid' then raise exception 'FAIL: a paid gift wasn''t saved'; end if;
  -- Raised to $25: charged the $15 it adds.
  ch := public.gift_charge('00000000-0000-4000-8000-0000000000b2', (select id from ids where habit_id = 'read'), 2500);
  if ch.amount_cents <> 1500 then raise exception 'FAIL: a raised gift charged %', ch.amount_cents; end if;
  perform public.card_charge_succeeded(ch.id, 'pi_gc_2');
  if (select amount_cents from public.extra_gifts where giver_id = '00000000-0000-4000-8000-0000000000b2') <> 2500
     or (select amount_cents from public.donations where giver_id = '00000000-0000-4000-8000-0000000000b2' and source = 'gift') <> 2500 then
    raise exception 'FAIL: the raised gift or its donation is wrong';
  end if;
  -- A raise past $100 by the time it's paid goes back whole.
  ch := public.gift_charge('00000000-0000-4000-8000-0000000000b2', (select id from ids where habit_id = 'read'), 10100);
  if public.card_charge_succeeded(ch.id, 'pi_gc_3') <> 'refund' then raise exception 'FAIL: a gift past $100 wasn''t refunded'; end if;
  if (select amount_cents from public.extra_gifts where giver_id = '00000000-0000-4000-8000-0000000000b2') <> 2500 then
    raise exception 'FAIL: a refused gift changed the gift';
  end if;
  begin
    perform public.gift_charge('00000000-0000-4000-8000-0000000000b2', (select id from ids where habit_id = 'read'), 2000);
    raise exception 'FAIL: a gift was lowered';
  exception when raise_exception then
    if sqlerrm <> 'gift_only_raise' then raise; end if;
  end;
end $$;

rollback;

select 'PASS: gifts by card checked as the giver, charged for what they add with no fee, counted once paid, refunded whole if they can''t count' as result;
