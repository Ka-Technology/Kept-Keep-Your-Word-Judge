-- Proves Solana S1 and S2's database side (migration 0055, T168, T169): a challenge signed with a token
-- waits for its payment, priced by the database (the stake plus service_fee_cents(), which agrees with
-- serviceFeeCents()); one without a token works as before; nobody pledges behind an unpaid challenge;
-- users read only their own payments and can't write them or mark one paid; the server confirms a
-- payment once, and an expired one removes its challenge.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/solana_payments_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A signs challenges; B is A's friend; C is a stranger.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a9', 'solana-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b9', 'solana-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000c9', 'solana-c@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a9', 'sol_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000b9', 'sol_test_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000c9', 'sol_test_c', '1990-01-01', 'TX');
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000b9', 'accepted', now());

-- The fee agrees with serviceFeeCents()'s tested values (challenge-rules.test.ts).
do $$
begin
  if (select array_agg(public.service_fee_cents(s) order by s) from unnest(array[100, 1000, 3500, 10000, 20000, 28200, 28300, 30000]) s)
     is distinct from array[153, 180, 255, 450, 750, 996, 999, 999] then
    raise exception 'FAIL: service_fee_cents() disagrees with serviceFeeCents()';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);

-- As A: a $25 Read paid in PYUSD, a $20 Journal paid in USDC, and Work out by card.
insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, pay_token, time_zone, consented_at)
  values ('read', 28, 2500, 'aspca', 'solana_usdc', 'PYUSD', 'America/Los_Angeles', now()),
         ('journal', 28, 2000, 'aspca', 'solana_usdc', 'USDC', 'America/Los_Angeles', now());
insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('workout', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now());

do $$
declare
  got text;
begin
  select string_agg(c.habit_id || ' ' || coalesce(c.payment_status, '-') || ' ' || coalesce(p.token || ' ' || p.stake_cents || '+' || p.fee_cents || ' ' || p.status, '-'), ', ' order by c.habit_id)
    into got from public.challenges c left join public.solana_payments p on p.challenge_id = c.id;
  if got is distinct from 'journal awaiting USDC 2000+210 awaiting, read awaiting PYUSD 2500+225 awaiting, workout - -' then
    raise exception 'FAIL: A''s challenges and payments are %', got;
  end if;

  -- Only the server prices, confirms or changes a payment.
  begin
    update public.challenges set payment_status = 'paid' where habit_id = 'read';
    raise exception 'FAIL: A marked a challenge paid';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.solana_payments set status = 'confirmed';
    raise exception 'FAIL: A changed a payment';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.solana_payments (user_id, token, stake_cents, fee_cents) values ('00000000-0000-4000-8000-0000000000a9', 'USDC', 1, 0);
    raise exception 'FAIL: A wrote a payment';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.solana_payment_confirmed((select id from public.solana_payments limit 1), 'sig', 'wallet');
    raise exception 'FAIL: A confirmed a payment';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.solana_payment_expired((select id from public.solana_payments limit 1));
    raise exception 'FAIL: A expired a payment';
  exception when insufficient_privilege then null;
  end;

  -- A token goes only with Solana, and only one Kept takes.
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, pay_token, time_zone, consented_at)
      values ('cook', 28, 1000, 'aspca', 'card', 'USDC', 'America/Los_Angeles', now());
    raise exception 'FAIL: a card challenge took a token';
  exception when check_violation then null;
  end;
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, pay_token, time_zone, consented_at)
      values ('cook', 28, 1000, 'aspca', 'solana_usdc', 'BONK', 'America/Los_Angeles', now());
    raise exception 'FAIL: a token Kept doesn''t take was accepted';
  exception when check_violation then null;
  end;

  -- An unpaid challenge isn't cancelled or quit like a running one (0057): nothing was paid to come back.
  begin
    update public.challenges set outcome = 'cancelled' where habit_id = 'read';
    raise exception 'FAIL: A cancelled an unpaid challenge as if paid';
  exception when check_violation then null;
  end;
end $$;

-- As B, A's friend: no pledge behind an unpaid challenge, and none of A's payments to read.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b9","role":"authenticated"}', true);
do $$
begin
  begin
    insert into public.pledges (challenge_id, amount_cents)
      values ((select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a9' and habit_id = 'read'), 2500);
    raise exception 'FAIL: B pledged behind an unpaid challenge';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.solana_payments) then raise exception 'FAIL: B reads A''s payments'; end if;
end $$;

-- As C, a stranger: nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c9","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.solana_payments) then raise exception 'FAIL: C reads A''s payments'; end if;
end $$;

-- The server: Read's PYUSD arrives (confirmed once; a second signature changes nothing), Journal's never does.
reset role;
select set_config('request.jwt.claims', '', true);
delete from net.http_request_queue where url like '%/functions/v1/notify';
select public.solana_payment_confirmed(id, 'sig-read', 'wallet-a') from public.solana_payments where token = 'PYUSD' and user_id = '00000000-0000-4000-8000-0000000000a9';
select public.solana_payment_confirmed(id, 'sig-again', 'wallet-x') from public.solana_payments where token = 'PYUSD' and user_id = '00000000-0000-4000-8000-0000000000a9';
select public.solana_payment_expired(id) from public.solana_payments where token = 'USDC' and user_id = '00000000-0000-4000-8000-0000000000a9';
-- Expiring a confirmed payment changes nothing.
select public.solana_payment_expired(id) from public.solana_payments where token = 'PYUSD' and user_id = '00000000-0000-4000-8000-0000000000a9';

-- One "Payment received" push, for the confirmation that worked (not the second signature, not the expiry).
do $$
declare
  n int;
begin
  select count(*) into n from net.http_request_queue
    where url like '%/functions/v1/notify' and convert_from(body, 'utf8')::jsonb ? 'solana_payment';
  if n <> 1 then raise exception 'FAIL: % "payment received" pushes were queued, not 1', n; end if;
  if (select convert_from(body, 'utf8')::jsonb ->> 'solana_payment' from net.http_request_queue where url like '%/functions/v1/notify' limit 1)
     is distinct from (select id::text from public.solana_payments where token = 'PYUSD' and user_id = '00000000-0000-4000-8000-0000000000a9') then
    raise exception 'FAIL: the push names another payment';
  end if;
end $$;

do $$
declare
  got text;
begin
  select string_agg(p.token || ' ' || p.status || ' ' || coalesce(p.signature, '-') || ' ' || coalesce(p.payer, '-') || ' ' || coalesce(c.habit_id || ' ' || c.payment_status, 'gone'), ', ' order by p.token)
    into got from public.solana_payments p left join public.challenges c on c.id = p.challenge_id where p.user_id = '00000000-0000-4000-8000-0000000000a9';
  if got is distinct from 'PYUSD confirmed sig-read wallet-a read paid, USDC expired - - gone' then
    raise exception 'FAIL: after the server, payments are %', got;
  end if;
  if exists (select 1 from public.challenges where habit_id = 'journal' and user_id = '00000000-0000-4000-8000-0000000000a9') then
    raise exception 'FAIL: the unpaid Journal challenge is still there';
  end if;
end $$;

-- As B again: the paid challenge takes pledges.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b9","role":"authenticated"}', true);
insert into public.pledges (challenge_id, amount_cents)
  values ((select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a9' and habit_id = 'read'), 2500);

rollback;

select 'PASS: Solana stakes wait for their payment, priced by the database; card and pretend challenges are unchanged; no pledge before payment; payments are own-only and server-written; confirmed once with one push, and an expired one removes its challenge' as result;
