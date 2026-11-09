-- Proves the escrow's database side (migration 0084, T229, decision 178): a stake that solana-pay locked in Kept's
-- escrow program carries its escrow and charity accounts, written only by the server; ending not finished owes its
-- donation to the charity's escrow account (so it is settled), while a treasury donation still waits with no address;
-- a cancel still goes back to the wallet that paid; an account can't be deleted while an escrowed donation is still
-- on its way; and the reconciliation counts only the treasury's money (an escrowed stake's fee, not its stake).
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked --project-ref sevdqembylaqlazpjpwq --yes -f supabase/tests/solana_escrow_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e8', 'sol-escrow-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000e9', 'sol-escrow-b@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000e8', 'se_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000e9', 'se_test_b', '1990-01-01', 'CA');

do $$
begin
  if has_column_privilege('authenticated', 'public.solana_payments', 'escrow', 'update')
     or has_column_privilege('authenticated', 'public.solana_payments', 'escrow_charity', 'update')
     or has_column_privilege('authenticated', 'public.solana_payments', 'escrow', 'insert')
     or has_column_privilege('authenticated', 'public.solana_payments', 'escrow_charity', 'insert') then
    raise exception 'FAIL: the app can write a payment''s escrow accounts';
  end if;
end $$;

-- The project's own devnet payments are in the books already: the checks below compare against these.
create temporary table books on commit drop as select * from public.solana_reconciliation();

-- A's three $20 USDT challenges ($22.10 with the fee), paid from wallet-a: Work out and Cook locked in the escrow
-- (as solana-pay writes them when it builds the transaction), Read on the treasury.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_token, time_zone, consented_at)
select '00000000-0000-4000-8000-0000000000e8', h, 28, 2000, 'aspca', 'solana_usdc', 'USDT', 'America/Los_Angeles', now()
from unnest(array['workout', 'read', 'cook']) h;
create temporary table ids on commit drop as
  select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000e8';
grant select on ids to authenticated;
update public.solana_payments p set escrow = 'escrow-' || c.habit_id, escrow_charity = 'charity-aspca'
from ids c where c.id = p.challenge_id and c.habit_id in ('workout', 'cook');
select public.solana_payment_confirmed(p.id, 'sig-in-' || c.habit_id, 'wallet-a')
from public.solana_payments p join ids c on c.id = p.challenge_id;

do $$
begin
  -- Both addresses or neither, and only on a stake.
  begin
    update public.solana_payments set escrow_charity = null where escrow = 'escrow-cook';
    raise exception 'FAIL: an escrow was kept without its charity account';
  exception when check_violation then null;
  end;
  begin
    update public.solana_payments set kind = 'pledge', pledge = '{}'::jsonb where escrow = 'escrow-cook';
    raise exception 'FAIL: a pledge was given an escrow';
  exception when check_violation then null;
  end;
end $$;

-- Work out and Read aren't finished; Cook is cancelled on Day 1.
update public.challenges set outcome = 'not_finished', ended_on_day = 9, ended_at = now() where id in (select id from ids where habit_id in ('workout', 'read'));
update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now() where id = (select id from ids where habit_id = 'cook');

do $$
declare
  got text;
begin
  select string_agg(c.habit_id || ' ' || o.kind || ' ' || o.amount_cents || ' to ' || coalesce(o.to_wallet, '-') || ' ' || o.status, ', ' order by c.habit_id)
    into got from public.solana_payouts o join ids c on c.id = o.challenge_id;
  if got is distinct from 'cook return 2000 to wallet-a due, read donation 2000 to - due, workout donation 2000 to charity-aspca due' then
    raise exception 'FAIL: the payouts written are %', got;
  end if;

  -- The treasury's books for USDT: in, only Read's $22.10 and the two escrowed fees ($2.10 each); out, nothing;
  -- owed, Read's donation. The escrowed stakes and their payouts aren't the treasury's.
  select (r.paid_in_cents - coalesce(b.paid_in_cents, 0)) || ' ' || (r.paid_out_cents - coalesce(b.paid_out_cents, 0)) || ' ' || (r.owed_cents - coalesce(b.owed_cents, 0))
    into got from public.solana_reconciliation() r left join books b on b.token = r.token where r.token = 'USDT';
  if got is distinct from '2630 0 2000' then raise exception 'FAIL: the reconciliation is %', got; end if;

  -- Cook's return lands, so only the escrowed donation is still on its way.
  perform public.solana_payout_sending((select id from public.solana_payouts where challenge_id = (select id from ids where habit_id = 'cook')), 'sig-out-cook', 1000);
  perform public.solana_payout_settled((select id from public.solana_payouts where challenge_id = (select id from ids where habit_id = 'cook')), true);
end $$;

-- As A: the escrowed donation on its way stops a deletion; once it has landed, the treasury's waiting donation doesn't.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e8","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.solana_payments where escrow is not null) <> 2 then raise exception 'FAIL: A doesn''t see their escrowed payments'; end if;
  begin
    perform public.delete_account();
    raise exception 'FAIL: an account was deleted with an escrowed donation still on its way';
  exception when raise_exception then
    if sqlerrm <> 'money_in_kept' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e9","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.solana_payments where escrow is not null) then raise exception 'FAIL: B sees A''s escrowed payments'; end if;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
select public.solana_payout_sending((select id from public.solana_payouts where challenge_id = (select id from ids where habit_id = 'workout')), 'sig-out-workout', 1000);
select public.solana_payout_settled((select id from public.solana_payouts where challenge_id = (select id from ids where habit_id = 'workout')), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e8","role":"authenticated"}', true);
select public.delete_account();
reset role;
do $$
begin
  if exists (select 1 from auth.users where id = '00000000-0000-4000-8000-0000000000e8') then
    raise exception 'FAIL: an account with only a treasury donation waiting couldn''t be deleted';
  end if;
end $$;

rollback;

select 'PASS: an escrowed stake''s accounts are server-written; not finished, its donation goes to the charity''s escrow account (a treasury one still waits); a cancel goes back; no deletion while it''s on its way; the treasury''s books leave the escrow out' as result;
