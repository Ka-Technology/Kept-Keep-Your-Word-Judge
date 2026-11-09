-- Proves the owner's money functions (migration 0071, T200, plan.md decision 161; docs/wiki/Money-Exceptions.md):
-- owner_balance_adjust() writes one keyed 'adjustment' entry with its reason, never without one;
-- owner_payout_reopen() puts a return stuck as 'sent' back to 'due', and nothing else; money_reconciliation()
-- adds up Kept's ledger to set beside Stripe's. The app (signed in or out) can call none of them.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/owner_money_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

do $$
declare
  f text;
begin
  foreach f in array array['public.owner_balance_adjust(uuid, integer, text, text)', 'public.owner_payout_reopen(uuid)', 'public.money_reconciliation()'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'FAIL: the app can call %', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'FAIL: the server can''t call %', f; end if;
  end loop;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ab', 'owner-money-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000bb', 'owner-money-b@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000ab', 'om_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000bb', 'om_test_b', '1990-01-01', 'CA');
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000ab', '00000000-0000-4000-8000-0000000000bb', 'accepted', now());

create temporary table before on commit drop as select * from public.money_reconciliation();

-- A's $25 Work out by card ($27.25 with the fee), and B's $25 pledge ($27.25), both paid; then cancelled on Day 1.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000ab', 'workout', 28, 2500, 'aspca', 'card', true, 'America/Los_Angeles', now());

do $$
declare
  ch public.charges;
  challenge uuid := (select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000ab');
begin
  perform public.card_charge_succeeded((select id from public.charges where challenge_id = challenge), 'pi_om_stake');
  ch := public.pledge_charge('00000000-0000-4000-8000-0000000000bb', challenge, 2500, false, false);
  perform public.card_charge_succeeded(ch.id, 'pi_om_pledge');
  update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now() where id = challenge;
  -- B's return goes back to the card ($25 refunded); A keeps theirs in Kept.
  perform public.card_refunded(ch.id, 2500);
  perform public.payout_sent((select id from public.payouts where challenge_id = challenge and source = 'pledge'), 'card');
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000ab","role":"authenticated"}', true);
select public.keep_in_balance((select id from public.my_money_back()));
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  r record;
begin
  select * into r from public.money_reconciliation();
  if r.cards_collected_cents - (select cards_collected_cents from before) <> 5450
     or r.cards_refunded_cents - (select cards_refunded_cents from before) <> 2500
     or r.balances_cents - (select balances_cents from before) <> 2500
     or r.fees_kept_cents - (select fees_kept_cents from before) <> 450 then
    raise exception 'FAIL: the reconciliation''s change is %', r;
  end if;

  -- The owner sends A's $25 back by hand (a deletion request, decision 151): one keyed entry, with its reason.
  perform public.owner_balance_adjust('00000000-0000-4000-8000-0000000000ab', -2500, 'Sent back by hand before deletion: re_test_1', 'deletion-a');
  perform public.owner_balance_adjust('00000000-0000-4000-8000-0000000000ab', -2500, 'Sent back by hand before deletion: re_test_1', 'deletion-a');
  if public.balance_cents('00000000-0000-4000-8000-0000000000ab') <> 0
     or (select reason from public.balance_entries where source = 'adjustment' and user_id = '00000000-0000-4000-8000-0000000000ab')
        is distinct from 'Sent back by hand before deletion: re_test_1' then
    raise exception 'FAIL: the adjustment isn''t one keyed entry with its reason';
  end if;
  begin
    perform public.owner_balance_adjust('00000000-0000-4000-8000-0000000000ab', 500, ' ', 'no-reason');
    raise exception 'FAIL: an adjustment went in without a reason';
  exception when raise_exception then
    if sqlerrm <> 'adjustment_needs_a_reason' then raise; end if;
  end;

  -- A return stuck as 'sent' (a send-back that failed) goes back to 'due'; a paid one doesn't move.
  update public.payouts set status = 'sent', destination = null
    where challenge_id = (select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000ab') and source = 'pledge';
  perform public.owner_payout_reopen((select id from public.payouts where source = 'pledge' and user_id = '00000000-0000-4000-8000-0000000000bb'));
  if (select status from public.payouts where source = 'pledge' and user_id = '00000000-0000-4000-8000-0000000000bb') <> 'due' then
    raise exception 'FAIL: a stuck return wasn''t reopened';
  end if;
  perform public.owner_payout_reopen((select id from public.payouts where source = 'stake' and user_id = '00000000-0000-4000-8000-0000000000ab'));
  if (select status from public.payouts where source = 'stake' and user_id = '00000000-0000-4000-8000-0000000000ab') <> 'paid' then
    raise exception 'FAIL: a paid payout was reopened';
  end if;
end $$;

rollback;

select 'PASS: owner-only balance adjustments (keyed, with a reason), reopening a stuck return, and the reconciliation; none open to the app' as result;
