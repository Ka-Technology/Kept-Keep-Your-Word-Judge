-- Solana S1 and S2 (T168, T169; SPEC-payments.md "Solana"): a stake paid in a dollar stablecoin on
-- Solana (USDC, USDT or PYUSD) moves up front, with Kept's fee, to Kept's treasury wallet, and the
-- challenge counts only once the server has found that transfer on chain.
--
-- The app sends the token it picked (`pay_token`) with the new challenge. Such a challenge starts
-- `awaiting` its payment, and a `solana_payments` row is written for it with the amount the database
-- works out (the stake plus service_fee_cents()). The `solana-pay` Edge Function builds the transfer
-- for the user's wallet (a Solana Pay transaction request), finds it on chain by its reference key, and
-- calls solana_payment_confirmed(); a challenge nobody paid for within 15 minutes is removed by
-- solana_payment_expired(). A challenge without `pay_token` (card, or the pretend USDC of builds
-- before this one) works as before: nothing is collected, so the beta's live app is unchanged.
-- ponytail: before live mode, a solana_usdc challenge must carry pay_token (SPEC-payments.md).
-- Proven by supabase/tests/solana_payments_rls.sql.

-- Kept's service fee, the SQL twin of serviceFeeCents() in src/lib/challenge-rules.ts ($1.50 + 3%,
-- at most $7.50), tested against the same values.
create function public.service_fee_cents(amount_cents int) returns int
  language sql immutable set search_path = ''
  as $$ select least(150 + round(amount_cents * 0.03)::int, 750) $$;

alter table public.challenges
  add column pay_token      text check (pay_token in ('USDC', 'USDT', 'PYUSD')),
  -- Null: nothing to collect up front (card, or the demo). Only the server changes it.
  add column payment_status text check (payment_status in ('awaiting', 'paid')),
  add constraint challenges_pay_token_solana check (pay_token is null or payment_method = 'solana_usdc');

grant insert (pay_token) on public.challenges to authenticated;

create table public.solana_payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  -- Null once an unpaid challenge has been removed.
  challenge_id uuid unique references public.challenges on delete set null,
  token        text not null,
  stake_cents  int  not null check (stake_cents > 0),
  fee_cents    int  not null check (fee_cents >= 0),
  -- The Solana Pay reference key the transfer carries, set by the function the first time a wallet asks.
  reference    text unique,
  -- When a wallet last asked for the transfer: its blockhash keeps it valid for about a minute after.
  requested_at timestamptz,
  status       text not null default 'awaiting' check (status in ('awaiting', 'confirmed', 'expired')),
  signature    text unique,
  -- The wallet the tokens came from: where a finished stake goes back to (S3).
  payer        text,
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint solana_payments_confirmed check ((status = 'confirmed') = (signature is not null and payer is not null and confirmed_at is not null))
);

create index solana_payments_awaiting_idx on public.solana_payments (created_at) where status = 'awaiting';

alter table public.solana_payments enable row level security;
revoke all on public.solana_payments from anon, authenticated;
grant select on public.solana_payments to authenticated;
create policy "own solana payments read" on public.solana_payments
  for select to authenticated using (user_id = (select auth.uid()));

-- A challenge with a token waits for its payment, which the database prices.
create function public.challenges_solana_awaiting() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.payment_status := case when new.pay_token is null then null else 'awaiting' end;
  return new;
end $$;

create trigger challenges_solana_awaiting before insert on public.challenges
  for each row execute function public.challenges_solana_awaiting();

create function public.challenges_solana_payment() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  insert into public.solana_payments (user_id, challenge_id, token, stake_cents, fee_cents)
    values (new.user_id, new.id, new.pay_token, new.stake_cents, public.service_fee_cents(new.stake_cents));
  return null;
end $$;

create trigger challenges_solana_payment after insert on public.challenges
  for each row when (new.pay_token is not null) execute function public.challenges_solana_payment();

-- Nobody pledges behind a challenge that may still be removed.
create function public.pledges_wait_for_payment() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if exists (select 1 from public.challenges c where c.id = new.challenge_id and c.payment_status = 'awaiting') then
    raise exception 'challenge_awaiting_payment' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger pledges_wait_for_payment before insert on public.pledges
  for each row execute function public.pledges_wait_for_payment();

-- The function found the transfer on chain (finalized, the right token, amount and destination).
create function public.solana_payment_confirmed(payment uuid, sig text, wallet text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  challenge uuid;
begin
  update public.solana_payments
    set status = 'confirmed', signature = sig, payer = wallet, confirmed_at = now()
    where id = payment and status = 'awaiting'
    returning challenge_id into challenge;
  update public.challenges set payment_status = 'paid' where id = challenge;
end $$;

-- Nobody paid: the challenge is removed, as if never signed. The function calls this only once no
-- transfer can still land (15 minutes after signing, and a few minutes after the wallet last asked).
create function public.solana_payment_expired(payment uuid) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  challenge uuid;
begin
  update public.solana_payments set status = 'expired'
    where id = payment and status = 'awaiting'
    returning challenge_id into challenge;
  delete from public.challenges where id = challenge and payment_status = 'awaiting';
end $$;

revoke execute on function public.challenges_solana_awaiting(), public.challenges_solana_payment(), public.pledges_wait_for_payment(),
  public.solana_payment_confirmed(uuid, text, text), public.solana_payment_expired(uuid)
  from public, anon, authenticated;
grant execute on function public.solana_payment_confirmed(uuid, text, text), public.solana_payment_expired(uuid) to service_role;

-- Every minute while a payment is awaited, the function looks for it on chain, and removes what
-- expired, so a challenge is confirmed even if the app was closed after signing. Uses the Vault
-- secrets from 0016.
select cron.schedule('solana-pay-sweep', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/solana-pay',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')
    ),
    body := '{"action":"sweep"}'::jsonb
  )
  where exists (select 1 from public.solana_payments where status = 'awaiting')
$$);
