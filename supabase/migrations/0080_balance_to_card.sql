-- Sending a kept balance back to its card (T189's leftover; decision 145: the balance is the person's own money).
-- What came into Kept balance from a return kept there (their own stake or pledge back, 0063's keep_in_balance())
-- can go back to the card it was paid from, as a refund of that charge, up to the balance there is now. A reward
-- never can: it was other people's money, and it waits for bank payouts (T190). `payments`' `balance-to-card`
-- takes each kept return in turn (card_returnable()), takes its part out of the balance first (balance_cash_out(),
-- a keyed 'cash_out' entry, under the same per-person lock as a charge), then refunds the card, and puts the
-- balance back if the refund fails. my_card_returnable() tells Wallet how much can go.
-- Proven by supabase/tests/balance_to_card_rls.sql.

alter table public.balance_entries drop constraint balance_entries_source_check;
alter table public.balance_entries add constraint balance_entries_source_check
  check (source in ('payout', 'charge', 'charge_back', 'withdraw', 'takeback', 'adjustment', 'cash_out'));

-- Each return the person kept in Kept, with what of it hasn't gone back to its card yet, oldest first.
create function public.card_returnable(person uuid)
  returns table (payout_id uuid, challenge_id uuid, source text, cents int)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, o.challenge_id, o.source,
           o.amount_cents + coalesce((select sum(e.amount_cents) from public.balance_entries e
                                      where e.payout_id = o.id and e.source = 'cash_out'), 0)::int
    from public.payouts o
    where o.user_id = person and o.kind = 'return' and o.destination = 'balance' and o.challenge_id is not null
      and o.amount_cents + coalesce((select sum(e.amount_cents) from public.balance_entries e
                                     where e.payout_id = o.id and e.source = 'cash_out'), 0) > 0
    order by o.created_at
  $$;

-- How much of the caller's balance can go back to a card now.
create function public.my_card_returnable() returns int
  language sql stable security definer set search_path = ''
  as $$
    select least(greatest(public.balance_cents((select auth.uid())), 0),
                 coalesce((select sum(r.cents) from public.card_returnable((select auth.uid())) r), 0))::int
  $$;

-- Takes `cents` of a kept return out of the balance, to go back to its card; once per key. Refused past what the
-- return still holds or what the balance has.
create function public.balance_cash_out(person uuid, payout uuid, cents int, entry_key text) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform pg_advisory_xact_lock(hashtext('kept-balance:' || person::text));
  if exists (select 1 from public.balance_entries where key = 'cash_out:' || entry_key) then return; end if;
  if cents <= 0 or cents > public.balance_cents(person)
     or cents > coalesce((select r.cents from public.card_returnable(person) r where r.payout_id = payout), 0) then
    raise exception 'cash_out_too_much';
  end if;
  insert into public.balance_entries (user_id, amount_cents, source, payout_id, key)
    values (person, -cents, 'cash_out', payout, 'cash_out:' || entry_key);
end $$;

revoke execute on function public.card_returnable(uuid), public.my_card_returnable(), public.balance_cash_out(uuid, uuid, int, text)
  from public, anon, authenticated;
grant execute on function public.card_returnable(uuid), public.balance_cash_out(uuid, uuid, int, text) to service_role;
grant execute on function public.my_card_returnable() to authenticated;
