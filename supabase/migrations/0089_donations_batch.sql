-- Card donations go to the charities in a monthly batch, by hand (T167 part 1; plan.md decision 177;
-- SPEC-payments.md "Donations"). Every.org has no card API for Kept, so the owner gives each charity what it is
-- owed on Every.org's own page, in Kept's name, then records it here. A donation row is now:
--   owed   recorded when the challenge ended, not given yet (the default)
--   given  the owner gave it: given_on is the day, receipt is Every.org's reference for the gift
-- A given row is Kept's record of money that left: record_donations() never changes or removes one.
-- The owner's functions (server only, like 0071's):
--   donations_owed(cutoff)                                what each charity is owed from card money recorded before a date
--   donation_batch_given(charity, cutoff, day, receipt,  marks that charity's rows given, if they still add up to
--                        expected_cents)                  what the owner just gave; otherwise it changes nothing
-- Crypto donations are left out: they go out through Every.org's crypto API (T167 part 2), not by hand.
-- A giver who deletes their account no longer takes an unsent donation with them: the row stays, without a giver,
-- so what Kept holds for the charity is never lost. money_reconciliation() counts only owed donations (a given one
-- has left Kept's bank). Proven by supabase/tests/donations_batch_rls.sql.

alter table public.donations
  alter column giver_id drop not null,
  drop constraint donations_giver_id_fkey,
  add constraint donations_giver_id_fkey foreign key (giver_id) references auth.users on delete set null,
  add column status   text not null default 'owed' check (status in ('owed', 'given')),
  add column given_on date,
  add column receipt  text,
  add constraint donations_given check ((status = 'given') = (given_on is not null and coalesce(trim(receipt), '') <> ''));

-- What the batch can still give: card money only, and only rows recorded before the date.
create index donations_owed_idx on public.donations (charity_id, created_at) where status = 'owed';

-- 0060's, with a given row left exactly as it is, however the ending changes afterwards.
create or replace function public.record_donations(challenge uuid) returns void
  language sql security definer set search_path = ''
  as $$
    with c as (
      select ch.id, ch.user_id, ch.charity_id, ch.stake_cents, ch.outcome,
             h.name || coalesce(' (' || initcap(ch.language) || ')', '') as habit
      from public.challenges ch join public.habits h on h.id = ch.habit_id
      where ch.id = challenge
    ),
    due as (
      select c.user_id as giver_id, 'stake' as source, c.stake_cents as amount_cents from c where c.outcome = 'not_finished'
      union all
      select c.user_id, 'shield', sum(s.charity_cents)::int from c join public.shield_purchases s on s.challenge_id = c.id
        group by c.user_id
      union all
      select p.pledger_id, 'pledge', p.amount_cents from c join public.pledges p on p.challenge_id = c.id
        where (c.outcome = 'finished' and p.to_charity_on_finish) or (c.outcome = 'not_finished' and p.donate_if_not_finished)
      union all
      select g.giver_id, 'gift', g.amount_cents from c join public.extra_gifts g on g.challenge_id = c.id
        where c.outcome is not null
    ),
    gone as (
      delete from public.donations d where d.challenge_id = challenge and d.status = 'owed'
        and not exists (select 1 from due where due.giver_id = d.giver_id and due.source = d.source)
    )
    insert into public.donations (giver_id, challenge_id, charity_id, source, amount_cents, habit)
    select due.giver_id, c.id, c.charity_id, due.source, due.amount_cents, c.habit from due, c
    on conflict (challenge_id, giver_id, source) do update set amount_cents = excluded.amount_cents
      where public.donations.status = 'owed'
  $$;

-- The one definition of "what the batch covers", for both owner functions below. A crypto donation (its giver has a
-- confirmed Solana payment on the challenge, a stake's or a pledge's) goes out through Every.org's crypto API.
create function public.card_donations_owed(cutoff date) returns setof public.donations
  language sql stable security definer set search_path = ''
  as $$
    select d.* from public.donations d
    where d.status = 'owed' and d.created_at < cutoff
      and not exists (
        select 1 from public.solana_payments s
        where s.user_id = d.giver_id and s.challenge_id = d.challenge_id and s.status = 'confirmed'
      )
  $$;

create function public.donations_owed(cutoff date)
  returns table (charity_id text, charity text, gifts int, amount_cents bigint)
  language sql stable security definer set search_path = ''
  as $$
    select d.charity_id, c.name, count(*)::int, sum(d.amount_cents)::bigint
    from public.card_donations_owed(cutoff) d join public.charities c on c.id = d.charity_id
    group by d.charity_id, c.name
    order by c.name
  $$;

-- Marks the charity's owed rows given, and returns how many. `expected_cents` is what the owner just gave: if the rows
-- no longer add up to it (one was recorded, raised or removed since the totals were read), nothing changes.
create function public.donation_batch_given(charity text, cutoff date, given_day date, receipt_ref text, expected_cents bigint)
  returns int
  language plpgsql security definer set search_path = ''
  as $$
declare
  marked int;
  total  bigint;
begin
  if coalesce(trim(receipt_ref), '') = '' then raise exception 'batch_needs_a_receipt'; end if;
  with u as (
    update public.donations d set status = 'given', given_on = given_day, receipt = trim(receipt_ref)
    where d.id in (select o.id from public.card_donations_owed(cutoff) o where o.charity_id = charity)
    returning d.amount_cents
  )
  select count(*)::int, coalesce(sum(amount_cents), 0) into marked, total from u;
  if total <> expected_cents then
    raise exception 'batch_changed: gave %, but % is owed', expected_cents, total;
  end if;
  return marked;
end $$;

-- 0071's, with only the donations still to be given counted.
create or replace function public.money_reconciliation()
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
      (select coalesce(sum(amount_cents), 0) from public.donations where status = 'owed')
  $$;

revoke execute on function public.card_donations_owed(date), public.donations_owed(date),
  public.donation_batch_given(text, date, date, text, bigint)
  from public, anon, authenticated;
grant execute on function public.donations_owed(date), public.donation_batch_given(text, date, date, text, bigint) to service_role;
