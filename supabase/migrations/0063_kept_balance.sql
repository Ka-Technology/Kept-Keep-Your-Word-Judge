-- Kept balance (T189; plan.md decision 145; SPEC-payments.md "Kept balance"). Money coming back to someone
-- (a return or a reward, 0060's payouts) can stay in Kept as their balance, their own money, or a return
-- can go back to its card (the `payments` function's `send-back`). A balance pays the next stake or pledge
-- first, with no fee on the part it covers (charges.balance_cents; the fee is worked out on what the card
-- pays). A charge that fails, expires, or is refunded whole gives its balance back. The balance is a ledger
-- only the server writes, one row per movement with a unique key, and never goes below zero. Only payouts
-- whose money was really collected (a paid card charge) can be chosen: the demo's pretend ones can't.
-- Kept credits stay separate (0062). Proven by supabase/tests/balance_rls.sql.

create table public.balance_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  -- In (positive) or out (negative), in cents.
  amount_cents int  not null check (amount_cents <> 0),
  -- Where the money sits: card dollars in Stripe (a stablecoin in the treasury joins with Solana's S3).
  rail         text not null default 'card' check (rail in ('card', 'solana')),
  source       text not null check (source in ('payout', 'charge', 'charge_back', 'withdraw')),
  charge_id    uuid references public.charges on delete set null,
  payout_id    uuid references public.payouts on delete set null,
  key          text not null unique,
  created_at   timestamptz not null default now()
);
create index balance_entries_user_id on public.balance_entries (user_id);

alter table public.balance_entries enable row level security;
revoke all on public.balance_entries from anon, authenticated;
grant select on public.balance_entries to authenticated;
create policy "own balance read" on public.balance_entries
  for select to authenticated using (user_id = (select auth.uid()));

-- Where a payout went once chosen; its receiver can read it.
alter table public.payouts add column destination text check (destination in ('balance', 'card', 'bank', 'wallet'));
grant select (destination) on public.payouts to authenticated;

create function public.balance_cents(person uuid) returns int
  language sql stable security definer set search_path = ''
  as $$ select coalesce(sum(amount_cents), 0)::int from public.balance_entries where user_id = person and rail = 'card' $$;

create function public.my_balance() returns int
  language sql stable security definer set search_path = ''
  as $$ select public.balance_cents((select auth.uid())) $$;

-- Money in, once per key. For the server's movements (send-back's balance part, a withdrawn pledge's).
create function public.balance_credit(person uuid, cents int, entry_key text, entry_source text, from_charge uuid, from_payout uuid)
  returns void
  language sql security definer set search_path = ''
  as $$
    insert into public.balance_entries (user_id, amount_cents, source, charge_id, payout_id, key)
      select person, cents, entry_source, from_charge, from_payout, entry_key where cents > 0
      on conflict (key) do nothing
  $$;

-- ── Spending: a balance pays a charge first ───────────────────────────────────────────────────────

-- 0062's, with Kept balance first: it pays as much of the amount as it can, the fee is worked out on what the
-- card pays (none when the balance covers it all), then credits come off that fee. What's left for the card
-- is never under Stripe's 50¢ minimum: credits take less instead. The twin of chargeFor() in challenge-rules.ts.
create or replace function public.charges_apply_credits() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  card int;
begin
  -- One charge at a time per person, so two can't spend the same balance or credits.
  perform pg_advisory_xact_lock(hashtext('kept-balance:' || new.user_id::text));
  new.balance_cents := least(new.amount_cents, greatest(public.balance_cents(new.user_id), 0));
  card := new.amount_cents - new.balance_cents;
  new.fee_cents := case when card = 0 then 0 else least(new.fee_cents, public.service_fee_cents(card)) end;
  new.credits_cents := least(new.fee_cents, greatest(public.credit_balance_cents(new.user_id), 0));
  if card > 0 and card + new.fee_cents - new.credits_cents < 50 then
    new.credits_cents := greatest(card + new.fee_cents - 50, 0);
  end if;
  return new;
end $$;

-- The balance a charge uses leaves the ledger as the charge is made.
create function public.charges_spend_balance() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  insert into public.balance_entries (user_id, amount_cents, source, charge_id, key)
    values (new.user_id, -new.balance_cents, 'charge', new.id, 'charge:' || new.id);
  return null;
end $$;
create trigger charges_spend_balance after insert on public.charges
  for each row when (new.balance_cents > 0) execute function public.charges_spend_balance();

-- ...and comes back if the charge fails or expires, or is refunded whole because nothing was bought.
create function public.charges_balance_back() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if (new.status in ('failed', 'expired') and old.status = 'pending')
     or (new.status = 'succeeded' and new.error is not null and old.error is null) then
    perform public.balance_credit(new.user_id, new.balance_cents, 'charge_back:' || new.id, 'charge_back', new.id, null);
  end if;
  return null;
end $$;
create trigger charges_balance_back after update of status, error on public.charges
  for each row when (new.balance_cents > 0) execute function public.charges_balance_back();

-- ── Money coming back: the choice ─────────────────────────────────────────────────────────────────

-- Whether a payout's money was really collected: a paid charge for the same giver, challenge and kind.
create function public.payout_backed(o public.payouts) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from public.charges ch
      where ch.user_id = o.giver_id and ch.challenge_id = o.challenge_id and ch.kind = o.source
        and ch.status = 'succeeded' and ch.error is null
    )
  $$;

-- The caller's money waiting for their choice: each due payout that real money backs. A reward can only
-- stay in Kept until bank payouts (T190); a return can also go back to its card.
create function public.my_money_back()
  returns table (id uuid, kind text, source text, amount_cents int, habit text, created_at timestamptz)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, o.kind, o.source, o.amount_cents, o.habit, o.created_at
    from public.payouts o
    where o.user_id = (select auth.uid()) and o.status = 'due' and public.payout_backed(o)
    order by o.created_at
  $$;

-- Keep it in Kept: the caller's own due, backed payout becomes balance, once.
create function public.keep_in_balance(payout uuid) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  o public.payouts;
begin
  select * into o from public.payouts where id = payout and user_id = (select auth.uid()) and status = 'due' for update;
  if not found or not public.payout_backed(o) then raise exception 'payout_not_yours'; end if;
  insert into public.balance_entries (user_id, amount_cents, source, payout_id, key)
    values (o.user_id, o.amount_cents, 'payout', o.id, 'payout:' || o.id);
  update public.payouts set destination = 'balance', status = 'paid' where id = o.id;
end $$;

-- send-back finished: the return went to its card (and any part a balance had paid, back to the balance).
create function public.payout_sent(payout uuid, sent_to text) returns void
  language sql security definer set search_path = ''
  as $$ update public.payouts set destination = sent_to, status = 'paid' where id = payout and status = 'due' $$;

revoke execute on function public.balance_cents(uuid), public.balance_credit(uuid, int, text, text, uuid, uuid),
  public.charges_apply_credits(), public.charges_spend_balance(), public.charges_balance_back(), public.payout_backed(public.payouts),
  public.payout_sent(uuid, text)
  from public, anon, authenticated;
grant execute on function public.balance_credit(uuid, int, text, text, uuid, uuid), public.payout_sent(uuid, text) to service_role;
revoke execute on function public.my_balance(), public.my_money_back(), public.keep_in_balance(uuid) from public, anon;
grant execute on function public.my_balance(), public.my_money_back(), public.keep_in_balance(uuid) to authenticated;
