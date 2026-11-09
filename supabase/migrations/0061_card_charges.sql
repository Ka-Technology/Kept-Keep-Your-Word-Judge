-- Card stakes and pledges charged up front (T93; plan.md decision 142; SPEC-payments.md "When money moves").
-- In builds with Stripe's key, a card challenge is signed with `pay_card` and waits for its payment like a
-- Solana one (0055: `payment_status = 'awaiting'`, no pledges, no ending): this migration writes its
-- `charges` row, priced by the database (the stake plus service_fee_cents()). The `payments` function
-- charges the default card on-session and calls card_charge_succeeded(), which marks the challenge paid.
-- A pledge by card is checked first (check_pledge(), as the pledger, rolled back), then priced
-- (pledge_charge()) and charged, and only then saved by card_charge_succeeded(), so an unpaid pledge never
-- counts anywhere. A charge still pending after 30 minutes (a bank check abandoned) expires, and its
-- unpaid challenge goes; money that arrives after that is refunded whole by the function. Builds without
-- the key are unchanged: nothing is charged. Proven by supabase/tests/charges_rls.sql.

-- ── A card challenge waits for its payment ────────────────────────────────────────────────────────

alter table public.challenges
  add column pay_card boolean not null default false,
  add constraint challenges_pay_card_card check (not pay_card or payment_method = 'card');
grant insert (pay_card) on public.challenges to authenticated;

-- 0055's trigger, for cards too.
create or replace function public.challenges_solana_awaiting() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.payment_status := case when new.pay_token is null and not new.pay_card then null else 'awaiting' end;
  return new;
end $$;

-- ── The ledger ────────────────────────────────────────────────────────────────────────────────────

create table public.charges (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade,
  challenge_id      uuid references public.challenges on delete set null,
  kind              text not null check (kind in ('stake', 'pledge')),
  -- The stake, the pledge, or what a raise adds.
  amount_cents      int  not null check (amount_cents > 0),
  fee_cents         int  not null check (fee_cents >= 0),
  -- Taken off the fee by Kept credits (T164) and off the total by Kept balance (T189).
  credits_cents     int  not null default 0 check (credits_cents >= 0),
  balance_cents     int  not null default 0 check (balance_cents >= 0),
  total_cents       int  generated always as (amount_cents + fee_cents - credits_cents - balance_cents) stored,
  -- A pledge's choices, applied once it's paid: { amount_cents (the new total), raise, donate_if_not_finished, to_charity_on_finish }.
  pledge            jsonb,
  status            text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'expired')),
  refunded_cents    int  not null default 0 check (refunded_cents >= 0),
  payment_intent_id text unique,
  error             text,
  -- Stripe's dispute status, if the cardholder disputed it (stripe-webhook); Stripe emails the owner too.
  dispute_status    text,
  -- Stripe's idempotency key, so a retry can never charge twice.
  key               text not null unique default gen_random_uuid()::text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint charges_pledge_choices check ((kind = 'pledge') = (pledge is not null)),
  constraint charges_refund_within check (refunded_cents <= total_cents),
  constraint charges_credits_within check (credits_cents <= fee_cents)
);
create index charges_user_id on public.charges (user_id);
create index charges_challenge_id on public.charges (challenge_id);
create index charges_pending_idx on public.charges (created_at) where status = 'pending';

alter table public.charges enable row level security;
revoke all on public.charges from anon, authenticated;
grant select on public.charges to authenticated;
create policy "own charges read" on public.charges
  for select to authenticated using (user_id = (select auth.uid()));

-- A card challenge's charge, priced by the database.
create function public.challenges_card_charge() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  insert into public.charges (user_id, challenge_id, kind, amount_cents, fee_cents)
    values (new.user_id, new.id, 'stake', new.stake_cents, public.service_fee_cents(new.stake_cents));
  return null;
end $$;
create trigger challenges_card_charge after insert on public.challenges
  for each row when (new.pay_card) execute function public.challenges_card_charge();

-- ── Pledges: check, price, then save once paid ────────────────────────────────────────────────────

-- Run as the pledger: tries the pledge (or the raise) against every rule the database has, then undoes it.
-- Raises the same errors a real pledge would (pledge_not_friend, pledge_outstanding_limit, ...).
create function public.check_pledge(challenge uuid, amount int) returns void
  language plpgsql set search_path = ''
  as $$
begin
  begin
    if exists (select 1 from public.pledges where challenge_id = challenge and pledger_id = (select auth.uid())) then
      update public.pledges set amount_cents = amount where challenge_id = challenge and pledger_id = (select auth.uid());
    else
      insert into public.pledges (challenge_id, amount_cents) values (challenge, amount);
    end if;
    raise exception 'pledge_check_passed';
  exception when raise_exception then
    if sqlerrm <> 'pledge_check_passed' then raise; end if;
  end;
end $$;

-- The charge for a new pledge (the pledge plus its fee) or a raise (the extra, plus the difference in fee).
create function public.pledge_charge(pledger uuid, challenge uuid, amount int, donate boolean, to_charity boolean)
  returns public.charges
  language plpgsql security definer set search_path = ''
  as $$
declare
  current int;
  ch public.charges;
begin
  select p.amount_cents into current from public.pledges p where p.challenge_id = challenge and p.pledger_id = pledger;
  if current is not null and amount <= current then raise exception 'pledge_only_raise'; end if;
  -- Not coalesce(service_fee_cents(current)): least() skips a null, so the fee of no pledge would be the cap.
  insert into public.charges (user_id, challenge_id, kind, amount_cents, fee_cents, pledge)
    values (pledger, challenge, 'pledge', amount - coalesce(current, 0),
            public.service_fee_cents(amount) - case when current is null then 0 else public.service_fee_cents(current) end,
            jsonb_build_object('amount_cents', amount, 'raise', current is not null,
                               'donate_if_not_finished', donate, 'to_charity_on_finish', to_charity))
    returning * into ch;
  return ch;
end $$;

-- Stripe says the money arrived. Marks the charge, then pays the challenge or saves the pledge. Answers
-- 'paid', 'already' (seen before, so a retry or the webhook changes nothing), or 'refund' when there's
-- nothing left to pay for (the unpaid challenge expired or was cancelled, or the pledge broke a rule in
-- the meantime): the function then refunds the whole charge.
create function public.card_charge_succeeded(charge uuid, intent text) returns text
  language plpgsql security definer set search_path = ''
  as $$
declare
  ch public.charges;
begin
  update public.charges set status = 'succeeded', payment_intent_id = intent, error = null, updated_at = now()
    where id = charge and status <> 'succeeded'
    returning * into ch;
  if not found then return 'already'; end if;
  if ch.kind = 'stake' then
    update public.challenges set payment_status = 'paid' where id = ch.challenge_id and payment_status = 'awaiting';
    return case when found then 'paid' else 'refund' end;
  end if;
  begin
    if (ch.pledge->>'raise')::boolean then
      update public.pledges set amount_cents = (ch.pledge->>'amount_cents')::int
        where challenge_id = ch.challenge_id and pledger_id = ch.user_id;
      if not found then raise exception 'pledge_gone'; end if;
    else
      insert into public.pledges (challenge_id, pledger_id, amount_cents, donate_if_not_finished, to_charity_on_finish)
        values (ch.challenge_id, ch.user_id, ch.amount_cents,
                (ch.pledge->>'donate_if_not_finished')::boolean, (ch.pledge->>'to_charity_on_finish')::boolean);
    end if;
  exception when others then
    update public.charges set error = sqlerrm where id = charge;
    return 'refund';
  end;
  return 'paid';
end $$;

-- The card was declined, or the challenger cancelled before paying: an unpaid challenge goes.
create function public.card_charge_failed(charge uuid, reason text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  ch public.charges;
begin
  update public.charges set status = 'failed', error = reason, updated_at = now()
    where id = charge and status = 'pending'
    returning * into ch;
  if found and ch.kind = 'stake' then
    delete from public.challenges where id = ch.challenge_id and payment_status = 'awaiting';
  end if;
end $$;

-- Money that went back to the card: the amount, never the fee (or all of it when nothing was bought).
create function public.card_refunded(charge uuid, cents int) returns void
  language sql security definer set search_path = ''
  as $$ update public.charges set refunded_cents = refunded_cents + cents, updated_at = now() where id = charge $$;

-- A charge still pending after 30 minutes expires, and an unpaid challenge with it. Two statements, not one:
-- deleting the challenge sets the charge's challenge_id null, which can't touch a row this statement updated.
create function public.card_charges_expire() returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  unpaid uuid[];
begin
  with gone as (
    update public.charges set status = 'expired', updated_at = now()
      where status = 'pending' and created_at < now() - interval '30 minutes'
      returning challenge_id, kind
  )
  select array_agg(challenge_id) into unpaid from gone where kind = 'stake';
  delete from public.challenges where id = any(unpaid) and payment_status = 'awaiting';
end $$;

select cron.schedule('card-charges-expire', '*/5 * * * *', $$ select public.card_charges_expire() $$);

revoke execute on function public.challenges_card_charge(), public.pledge_charge(uuid, uuid, int, boolean, boolean),
  public.card_charge_succeeded(uuid, text), public.card_charge_failed(uuid, text), public.card_refunded(uuid, int),
  public.card_charges_expire(), public.challenges_solana_awaiting()
  from public, anon, authenticated;
grant execute on function public.pledge_charge(uuid, uuid, int, boolean, boolean), public.card_charge_succeeded(uuid, text),
  public.card_charge_failed(uuid, text), public.card_refunded(uuid, int) to service_role;
revoke execute on function public.check_pledge(uuid, int) from public, anon;
grant execute on function public.check_pledge(uuid, int) to authenticated;
