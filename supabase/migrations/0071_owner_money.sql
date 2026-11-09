-- The owner's money functions (T200; plan.md decision 161). Money exceptions are handled by hand in 1.0, in the
-- Stripe and Supabase dashboards, following docs/wiki/Money-Exceptions.md; these let each fix land in Kept's
-- ledger too, so it always matches Stripe. Only the server's key (and the dashboard's SQL editor) can run them:
--   owner_balance_adjust(person, cents, reason, key)  one keyed 'adjustment' entry in a Kept balance, with its
--                                                      reason, e.g. a balance sent back by hand before a deletion
--   owner_payout_reopen(payout)                        a return stuck as 'sent' (its send-back failed before any
--                                                      money moved) goes back to 'due', for the person to choose
--   money_reconciliation()                             Kept's ledger added up, to set beside Stripe's balance
-- Proven by supabase/tests/owner_money_rls.sql.

alter table public.balance_entries add column reason text;
alter table public.balance_entries drop constraint balance_entries_source_check;
alter table public.balance_entries add constraint balance_entries_source_check
  check (source in ('payout', 'charge', 'charge_back', 'withdraw', 'takeback', 'adjustment'));

create function public.owner_balance_adjust(person uuid, cents int, why text, entry_key text) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  if coalesce(trim(why), '') = '' then raise exception 'adjustment_needs_a_reason'; end if;
  insert into public.balance_entries (user_id, amount_cents, source, reason, key)
    values (person, cents, 'adjustment', why, 'adjust:' || entry_key)
    on conflict (key) do nothing;
end $$;

create function public.owner_payout_reopen(payout uuid) returns void
  language sql security definer set search_path = ''
  as $$ update public.payouts set status = 'due' where id = payout and status = 'sent' and kind = 'return' $$;

-- Every number in cents, from Kept's own records:
--   cards_collected   what card charges took in (Stripe's gross volume for Kept's charges)
--   cards_refunded    what went back to cards
--   disputed          what banks took back in disputes (T194)
--   fees_kept         Kept's service fees, less credits, on charges that stand
--   balances          everyone's Kept balance (what Kept owes, in Kept)
--   returns_waiting   backed returns not yet chosen for or still being sent
--   held_running      stakes and pledges on challenges still running
--   donations         recorded donations, pretend ones included until the launch wipe (decision 165)
create function public.money_reconciliation()
  returns table (cards_collected_cents bigint, cards_refunded_cents bigint, disputed_cents bigint, fees_kept_cents bigint,
                 balances_cents bigint, returns_waiting_cents bigint, held_running_cents bigint, donations_cents bigint)
  language sql stable security definer set search_path = ''
  as $$
    select
      (select coalesce(sum(total_cents), 0) from public.charges where status = 'succeeded' and payment_intent_id is not null),
      (select coalesce(sum(refunded_cents), 0) from public.charges where status = 'succeeded' and payment_intent_id is not null),
      (select coalesce(sum(total_cents - refunded_cents), 0) from public.charges where taken_back = 'dispute'),
      (select coalesce(sum(fee_cents - credits_cents), 0) from public.charges where status = 'succeeded' and error is null and taken_back is null),
      (select coalesce(sum(amount_cents), 0) from public.balance_entries where rail = 'card'),
      (select coalesce(sum(o.amount_cents), 0) from public.payouts o
         where o.kind = 'return' and o.status in ('due', 'sent') and public.payout_backed(o)),
      (select coalesce(sum(ch.amount_cents), 0) from public.charges ch join public.challenges c on c.id = ch.challenge_id
         where ch.status = 'succeeded' and ch.error is null and ch.taken_back is null and c.outcome is null),
      (select coalesce(sum(amount_cents), 0) from public.donations)
  $$;

revoke execute on function public.owner_balance_adjust(uuid, int, text, text), public.owner_payout_reopen(uuid), public.money_reconciliation()
  from public, anon, authenticated;
grant execute on function public.owner_balance_adjust(uuid, int, text, text), public.owner_payout_reopen(uuid), public.money_reconciliation()
  to service_role;
