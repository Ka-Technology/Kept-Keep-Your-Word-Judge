-- Disputes and fraud warnings taken back from the finisher (T194; plan.md decision 153; SPEC-payments.md
-- "Disputes"). When a pledge's card charge gets an early fraud warning from Stripe Radar, or a dispute,
-- `stripe-webhook` calls pledge_taken_back() once per charge, then refunds a warned charge whole (before it can
-- become a dispute: no $15 fee, and Kept's dispute rate stays down). What the pledge's money had become decides
-- the rest:
--   - the challenge is still running: the pledge is withdrawn, as if by its pledger (the webhook gives its other
--     charges back the way they came; the warned charge's balance part goes back to its pledger here);
--   - it became a finisher's reward: its card part comes out of their Kept balance, as one keyed 'takeback' entry.
--     A balance can't cover it all only when it was spent; then the balance goes below zero, which pays nothing
--     (charges_apply_credits() already takes greatest(balance, 0)) and is paid off first by whatever comes in
--     next, a reward or a return kept in Kept. That's "owed against their next reward or balance";
--   - it's a return still due (a failure or a cancel): it stops, since the bank already gave the money back. Less
--     the charge's part, if the pledge had other charges;
--   - it went to the charity, or already went back: Kept carries it, and the owner sees it in Stripe.
-- A stake's dispute is only recorded (stripe-webhook): the owner answers it in the Dashboard.
-- my_takebacks() lists a person's own take-backs for Wallet. Proven by supabase/tests/takeback_rls.sql.

alter table public.charges add column taken_back text check (taken_back in ('fraud_warning', 'dispute'));

alter table public.balance_entries drop constraint balance_entries_source_check;
alter table public.balance_entries add constraint balance_entries_source_check
  check (source in ('payout', 'charge', 'charge_back', 'withdraw', 'takeback'));

-- Answers what it did: 'withdrawn', 'taken_back', 'stopped', 'kept_carries', 'already', or 'not_a_pledge'.
create function public.pledge_taken_back(charge uuid, why text) returns text
  language plpgsql security definer set search_path = ''
  as $$
declare
  ch public.charges;
  c public.challenges;
  o public.payouts;
  card int;
begin
  if not exists (select 1 from public.charges where id = charge and kind = 'pledge') then return 'not_a_pledge'; end if;
  update public.charges set taken_back = why, updated_at = now()
    where id = charge and status = 'succeeded' and error is null and taken_back is null
    returning * into ch;
  if not found then return 'already'; end if;
  card := ch.amount_cents - ch.balance_cents;

  select * into c from public.challenges where id = ch.challenge_id;
  if found and c.outcome is null then
    delete from public.pledges where challenge_id = c.id and pledger_id = ch.user_id;
    perform public.balance_credit(ch.user_id, ch.balance_cents, 'takeback:' || ch.id, 'withdraw', ch.id, null);
    return 'withdrawn';
  end if;

  select * into o from public.payouts
    where challenge_id = ch.challenge_id and giver_id = ch.user_id and source = 'pledge'
    for update;
  if not found or card = 0 then return 'kept_carries'; end if;
  if o.status = 'due' then
    if o.amount_cents > card then
      update public.payouts set amount_cents = amount_cents - card where id = o.id;
    else
      update public.payouts set status = 'failed' where id = o.id;
    end if;
    return 'stopped';
  end if;
  if o.destination = 'balance' then
    insert into public.balance_entries (user_id, amount_cents, source, charge_id, payout_id, key)
      values (o.user_id, -least(card, o.amount_cents), 'takeback', ch.id, o.id, 'takeback:' || ch.id);
    return 'taken_back';
  end if;
  return 'kept_carries';
end $$;

-- Wallet: the caller's own take-backs, newest first, with the habit they came from (never whose pledge it was).
create function public.my_takebacks()
  returns table (id uuid, habit text, amount_cents int, created_at timestamptz)
  language sql stable security definer set search_path = ''
  as $$
    select e.id, o.habit, e.amount_cents, e.created_at
    from public.balance_entries e join public.payouts o on o.id = e.payout_id
    where e.user_id = (select auth.uid()) and e.source = 'takeback'
    order by e.created_at desc
  $$;

revoke execute on function public.pledge_taken_back(uuid, text), public.my_takebacks() from public, anon, authenticated;
grant execute on function public.pledge_taken_back(uuid, text) to service_role;
grant execute on function public.my_takebacks() to authenticated;
