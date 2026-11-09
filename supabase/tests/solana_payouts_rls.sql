-- Proves Solana S3's database side (migration 0072, T170): when a challenge paid in crypto ends, a payout row is
-- written once for its stake, by Kept's rules (finished or cancelled: back to the wallet that paid; not finished:
-- a donation, which waits for gate D1), never Kept's fee, and never for the demo's pretend crypto; an outcome
-- that changes while it's due changes it; the server marks it sent once, settles it, or puts it back after its
-- blockhash expired; users read only their own; nothing open to the app; an account can't be deleted while one
-- is still on its way.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/solana_payouts_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ac', 'sol-out-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000bc', 'sol-out-b@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000ac', 'so_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000bc', 'so_test_b', '1990-01-01', 'CA');

do $$
begin
  if has_any_column_privilege('authenticated', 'public.solana_payouts', 'insert')
     or has_any_column_privilege('authenticated', 'public.solana_payouts', 'update')
     or has_table_privilege('authenticated', 'public.solana_payouts', 'delete')
     or has_table_privilege('anon', 'public.solana_payouts', 'select') then
    raise exception 'FAIL: the app can write Solana payouts, or anon can read them';
  end if;
  if has_function_privilege('authenticated', 'public.solana_payout_sending(uuid, text, bigint)', 'execute')
     or has_function_privilege('authenticated', 'public.solana_payout_settled(uuid, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.solana_payout_expired(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.solana_reconciliation()', 'execute') then
    raise exception 'FAIL: the app can move a Solana payout';
  end if;
end $$;

-- The project's own devnet payments are in the books already: the checks below compare against these.
create temporary table books on commit drop as select * from public.solana_reconciliation();

-- A's four crypto challenges, each $20 in USDC ($22.10 with the fee), paid from wallet-a; and a pretend one.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_token, time_zone, consented_at)
select '00000000-0000-4000-8000-0000000000ac', h, 28, 2000, 'aspca', 'solana_usdc', 'USDC', 'America/Los_Angeles', now()
from unnest(array['workout', 'read', 'cook', 'journal']) h;
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000ac', 'stretch', 28, 2000, 'aspca', 'solana_usdc', 'America/Los_Angeles', now());
create temporary table ids on commit drop as
  select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000ac';
grant select on ids to authenticated;
select public.solana_payment_confirmed(p.id, 'sig-in-' || c.habit_id, 'wallet-a')
from public.solana_payments p join ids c on c.id = p.challenge_id;

delete from net.http_request_queue where url like '%/functions/v1/solana-pay';

-- Work out finishes, Read doesn't, Cook is cancelled on Day 1; Journal still runs; the pretend Stretch finishes.
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() where id in (select id from ids where habit_id in ('workout', 'stretch'));
update public.challenges set outcome = 'not_finished', ended_on_day = 9, ended_at = now() where id = (select id from ids where habit_id = 'read');
update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now() where id = (select id from ids where habit_id = 'cook');

do $$
declare
  got text;
begin
  select string_agg(c.habit_id || ' ' || o.kind || ' ' || o.amount_cents || ' ' || o.token || ' to ' || coalesce(o.to_wallet, '-') || ' ' || o.status, ', ' order by c.habit_id)
    into got from public.solana_payouts o join ids c on c.id = o.challenge_id;
  if got is distinct from 'cook return 2000 USDC to wallet-a due, read donation 2000 USDC to - due, workout return 2000 USDC to wallet-a due' then
    raise exception 'FAIL: the payouts written are %', got;
  end if;
  if (select count(*) from net.http_request_queue where url like '%/functions/v1/solana-pay') < 1 then
    raise exception 'FAIL: an ending didn''t ask solana-pay to send its payouts';
  end if;

  -- The dashboard clears Read's outcome and records a finish instead: the due donation becomes a return.
  update public.challenges set outcome = null, ended_on_day = null, ended_at = null where id = (select id from ids where habit_id = 'read');
  if exists (select 1 from public.solana_payouts where challenge_id = (select id from ids where habit_id = 'read')) then
    raise exception 'FAIL: a cleared outcome kept its due payout';
  end if;
  update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() where id = (select id from ids where habit_id = 'read');
  if (select kind || ' ' || to_wallet from public.solana_payouts where challenge_id = (select id from ids where habit_id = 'read')) is distinct from 'return wallet-a' then
    raise exception 'FAIL: a changed outcome didn''t change its due payout';
  end if;

  -- Sent once; settled; or put back for a fresh send after its blockhash expired.
  if not public.solana_payout_sending((select id from public.solana_payouts where challenge_id = (select id from ids where habit_id = 'workout')), 'sig-out-1', 1000) then
    raise exception 'FAIL: a due payout couldn''t be sent';
  end if;
  if public.solana_payout_sending((select id from public.solana_payouts where challenge_id = (select id from ids where habit_id = 'workout')), 'sig-out-2', 1001) then
    raise exception 'FAIL: a payout was sent twice';
  end if;
  perform public.solana_payout_expired((select id from public.solana_payouts where challenge_id = (select id from ids where habit_id = 'workout')));
  if (select status || ' ' || coalesce(signature, '-') from public.solana_payouts where challenge_id = (select id from ids where habit_id = 'workout')) <> 'due -' then
    raise exception 'FAIL: an expired send wasn''t put back';
  end if;
  perform public.solana_payout_sending((select id from public.solana_payouts where challenge_id = (select id from ids where habit_id = 'workout')), 'sig-out-3', 2000);
  perform public.solana_payout_settled((select id from public.solana_payouts where challenge_id = (select id from ids where habit_id = 'workout')), true);
  if (select status || ' ' || signature from public.solana_payouts where challenge_id = (select id from ids where habit_id = 'workout')) <> 'confirmed sig-out-3' then
    raise exception 'FAIL: a landed payout isn''t confirmed';
  end if;
  -- A confirmed payout never changes, even if the outcome does.
  update public.challenges set outcome = null, ended_on_day = null, ended_at = null where id = (select id from ids where habit_id = 'workout');
  if (select status from public.solana_payouts where challenge_id = (select id from ids where habit_id = 'workout')) <> 'confirmed' then
    raise exception 'FAIL: a confirmed payout changed';
  end if;
  update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() where id = (select id from ids where habit_id = 'workout');

  -- The owner's reconciliation, for USDC: $88.40 in, $20 out, $40 still due (Read and Cook).
  select (r.paid_in_cents - coalesce(b.paid_in_cents, 0)) || ' ' || (r.paid_out_cents - coalesce(b.paid_out_cents, 0)) || ' ' || (r.owed_cents - coalesce(b.owed_cents, 0))
    into got from public.solana_reconciliation() r left join books b on b.token = r.token where r.token = 'USDC';
  if got is distinct from '8840 2000 4000' then raise exception 'FAIL: the reconciliation is %', got; end if;
end $$;

-- Journal ends unfinished, so nothing of A's runs: only the returns still on their way stop a deletion.
update public.challenges set outcome = 'not_finished', ended_on_day = 9, ended_at = now() where id = (select id from ids where habit_id = 'journal');

-- As A: their own payouts; B sees none.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000ac","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.solana_payouts) <> 4 then raise exception 'FAIL: A doesn''t see their own payouts'; end if;
  begin
    perform public.delete_account();
    raise exception 'FAIL: an account was deleted with crypto still on its way';
  exception when raise_exception then
    if sqlerrm <> 'money_in_kept' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000bc","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.solana_payouts) then raise exception 'FAIL: B sees A''s payouts'; end if;
end $$;

rollback;

select 'PASS: a crypto stake''s payout written once by Kept''s rules (back to its wallet, or a donation), never the fee or pretend crypto; sent once, settled or re-sent after expiry; own-only reads, server-only writes' as result;
