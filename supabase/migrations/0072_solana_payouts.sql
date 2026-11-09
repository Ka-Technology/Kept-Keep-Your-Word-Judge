-- Solana S3, money out (T170; SPEC-payments.md "Solana"). When a challenge paid in crypto ends, its stake leaves
-- the treasury once, to the right place, and is recorded only after it lands:
--   - finished, or cancelled on Day 1: a `return` of the stake to the wallet that paid (solana_payments.payer);
--   - not finished: a `donation` of the stake, which waits for Every.org's donation endpoint (decision 167) before it moves;
--   - Kept's fee never moves, and the demo's pretend crypto (no pay_token) writes nothing.
-- A `reward` (a crypto pledge to a crypto challenger) joins with S4 (T171).
-- `solana-pay`'s `payouts` action (pg_cron every minute while one is due or sent, and a call right after an
-- ending) sends each: it checks the treasury holds the amount at `finalized`, signs a transferChecked with the
-- treasury key (Kept's fee payer pays the network fee, and the rent if the wallet's token account is gone), and
-- marks the payout `sent` with that transaction's signature before broadcasting it (solana_payout_sending()), so
-- a retry can never send a second one. It's `confirmed` once found on chain, `failed` if it landed with an
-- error, and only after its blockhash expired without landing does it go back to `due` for a fresh send.
-- An account can't be deleted while a return is due or on its way (0065's money_in_kept).
-- solana_reconciliation() sets the treasury's books beside its balance on chain. Challenges that ended before
-- this migration with a confirmed payment get their payout too (devnet only; production has none).
-- Proven by supabase/tests/solana_payouts_rls.sql.

create table public.solana_payouts (
  id                uuid primary key default gen_random_uuid(),
  payment_id        uuid not null unique references public.solana_payments on delete cascade,
  -- Whose Wallet shows it: the payer, for their stake back or given.
  user_id           uuid not null references auth.users on delete cascade,
  challenge_id      uuid references public.challenges on delete set null,
  kind              text not null check (kind in ('return', 'donation', 'reward')),
  -- Where it goes; null for a donation until Every.org's endpoint names the address.
  to_wallet         text,
  token             text not null,
  amount_cents      int  not null check (amount_cents > 0),
  status            text not null default 'due' check (status in ('due', 'sent', 'confirmed', 'failed')),
  signature         text unique,
  -- The block height after which the sent transaction can never land.
  last_valid_height bigint,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  confirmed_at      timestamptz,
  constraint solana_payouts_wallet check (kind = 'donation' or to_wallet is not null),
  constraint solana_payouts_sent check ((status in ('sent', 'confirmed', 'failed')) = (signature is not null))
);
create index solana_payouts_user_id on public.solana_payouts (user_id);
create index solana_payouts_moving_idx on public.solana_payouts (status) where status in ('due', 'sent');

alter table public.solana_payouts enable row level security;
revoke all on public.solana_payouts from anon, authenticated;
grant select on public.solana_payouts to authenticated;
create policy "own solana payouts read" on public.solana_payouts
  for select to authenticated using (user_id = (select auth.uid()));

-- What a crypto challenge's stake is owed, from its outcome; a due payout follows a changed outcome, one that
-- moved never changes.
create function public.record_solana_payouts(challenge uuid) returns void
  language sql security definer set search_path = ''
  as $$
    with gone as (
      delete from public.solana_payouts o using public.challenges c
      where o.challenge_id = challenge and c.id = challenge and c.outcome is null and o.status = 'due'
    )
    insert into public.solana_payouts (payment_id, user_id, challenge_id, kind, to_wallet, token, amount_cents)
    select p.id, p.user_id, c.id,
           case when c.outcome = 'not_finished' then 'donation' else 'return' end,
           case when c.outcome = 'not_finished' then null else p.payer end,
           p.token, p.stake_cents
    from public.challenges c join public.solana_payments p on p.challenge_id = c.id and p.status = 'confirmed'
    where c.id = challenge and c.outcome is not null
    on conflict (payment_id) do update set kind = excluded.kind, to_wallet = excluded.to_wallet
      where public.solana_payouts.status = 'due'
  $$;

-- Asks solana-pay to send what's due now, rather than at the next minute.
create function public.call_solana_payouts() returns void
  language sql security definer set search_path = ''
  as $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/solana-pay',
      body := '{"action":"payouts"}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')
      )
    );
  $$;

create function public.challenges_solana_payouts() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if not exists (select 1 from public.solana_payments where challenge_id = new.id and status = 'confirmed') then return null; end if;
  perform public.record_solana_payouts(new.id);
  if exists (select 1 from public.solana_payouts where challenge_id = new.id and status = 'due' and to_wallet is not null) then
    perform public.call_solana_payouts();
  end if;
  return null;
end $$;
create trigger challenges_solana_payouts after update of outcome on public.challenges
  for each row execute function public.challenges_solana_payouts();

-- ── The sender's steps (solana-pay, with the secret key) ──────────────────────────────────────────

-- Due → sent, with the transaction's signature, before it's broadcast. False if it wasn't due (sent already).
create function public.solana_payout_sending(payout uuid, sig text, height bigint) returns boolean
  language plpgsql security definer set search_path = ''
  as $$
begin
  update public.solana_payouts set status = 'sent', signature = sig, last_valid_height = height, sent_at = now()
    where id = payout and status = 'due' and to_wallet is not null;
  return found;
end $$;

-- Found on chain: confirmed, or failed if it landed with an error (the owner looks; it isn't re-sent).
create function public.solana_payout_settled(payout uuid, landed boolean) returns void
  language sql security definer set search_path = ''
  as $$
    update public.solana_payouts set status = case when landed then 'confirmed' else 'failed' end,
           confirmed_at = case when landed then now() end
    where id = payout and status = 'sent'
  $$;

-- Its blockhash expired and it never landed, so it never can: back to due, for a fresh transaction.
create function public.solana_payout_expired(payout uuid) returns void
  language sql security definer set search_path = ''
  as $$
    update public.solana_payouts set status = 'due', signature = null, last_valid_height = null, sent_at = null
    where id = payout and status = 'sent'
  $$;

-- Per token, in cents: what came into the treasury, what went out, and what it still owes (returns, rewards and
-- donations not yet confirmed). On chain the treasury should hold paid_in - paid_out, of which owed isn't Kept's.
create function public.solana_reconciliation()
  returns table (token text, paid_in_cents bigint, paid_out_cents bigint, owed_cents bigint)
  language sql stable security definer set search_path = ''
  as $$
    select t.token,
           (select coalesce(sum(p.stake_cents + p.fee_cents), 0) from public.solana_payments p where p.token = t.token and p.status = 'confirmed'),
           (select coalesce(sum(o.amount_cents), 0) from public.solana_payouts o where o.token = t.token and o.status = 'confirmed'),
           (select coalesce(sum(o.amount_cents), 0) from public.solana_payouts o where o.token = t.token and o.status in ('due', 'sent'))
    from (select distinct p.token from public.solana_payments p where p.status = 'confirmed') t
  $$;

-- Every minute while a payout is due with an address, or sent and not yet found.
select cron.schedule('solana-payouts', '* * * * *', $$
  select public.call_solana_payouts()
  where exists (select 1 from public.solana_payouts where status = 'sent' or (status = 'due' and to_wallet is not null))
$$);

-- 0065's, with a crypto return still due or on its way counted as money in Kept.
create or replace function public.delete_account() returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  if exists (select 1 from public.challenges c where c.user_id = auth.uid() and c.outcome is null)
     or exists (
       select 1 from public.pledges p join public.challenges c on c.id = p.challenge_id
       where p.pledger_id = auth.uid() and c.outcome is null
     ) then
    raise exception 'money_still_promised' using errcode = 'P0001';
  end if;
  if public.balance_cents(auth.uid()) > 0
     or exists (select 1 from public.payouts o where o.user_id = auth.uid() and o.status = 'due' and public.payout_backed(o))
     or exists (select 1 from public.solana_payouts s where s.user_id = auth.uid() and s.kind <> 'donation' and s.status in ('due', 'sent')) then
    raise exception 'money_in_kept' using errcode = 'P0001';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- Crypto challenges that already ended (devnet), including the owner's Day 1 cancel of 2026-10-26.
select public.record_solana_payouts(p.challenge_id)
from public.solana_payments p join public.challenges c on c.id = p.challenge_id
where p.status = 'confirmed' and c.outcome is not null;

revoke execute on function public.record_solana_payouts(uuid), public.call_solana_payouts(), public.challenges_solana_payouts(),
  public.solana_payout_sending(uuid, text, bigint), public.solana_payout_settled(uuid, boolean), public.solana_payout_expired(uuid),
  public.solana_reconciliation()
  from public, anon, authenticated;
grant execute on function public.solana_payout_sending(uuid, text, bigint), public.solana_payout_settled(uuid, boolean),
  public.solana_payout_expired(uuid), public.solana_reconciliation() to service_role;
