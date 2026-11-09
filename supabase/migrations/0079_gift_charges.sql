-- Extra gifts paid by card (T93's leftover; SPEC-pledges.md decision 11; SPEC-payments.md "When money moves": a
-- gift is charged when it's given, with no fee). Like a pledge (0061): `payments` checks the gift as its giver
-- (check_gift(), every rule in 0023, undone), prices it (gift_charge(): what a new gift or a raise adds), charges
-- the card, and card_charge_succeeded() saves it once paid; one that breaks a rule by then (past $100, say) is
-- refunded whole. The donation follows from the gift as before (0033). Builds without Stripe's key still save a
-- pretend gift directly. Proven by supabase/tests/gift_charges_rls.sql.

alter table public.charges drop constraint charges_kind_check;
alter table public.charges add constraint charges_kind_check check (kind in ('stake', 'pledge', 'gift'));

-- Run as the giver: tries the gift (or the raise) against every rule, then undoes it.
create function public.check_gift(challenge uuid, amount int) returns void
  language plpgsql set search_path = ''
  as $$
begin
  begin
    if exists (select 1 from public.extra_gifts where challenge_id = challenge and giver_id = (select auth.uid())) then
      update public.extra_gifts set amount_cents = amount where challenge_id = challenge and giver_id = (select auth.uid());
    else
      insert into public.extra_gifts (challenge_id, amount_cents) values (challenge, amount);
    end if;
    raise exception 'gift_check_passed';
  exception when raise_exception then
    if sqlerrm <> 'gift_check_passed' then raise; end if;
  end;
end $$;

-- The charge for a gift that comes to `amount` in all: what it adds, with no fee.
create function public.gift_charge(giver uuid, challenge uuid, amount int) returns public.charges
  language plpgsql security definer set search_path = ''
  as $$
declare
  current int := coalesce((select g.amount_cents from public.extra_gifts g where g.challenge_id = challenge and g.giver_id = giver), 0);
  ch public.charges;
begin
  if amount <= current then raise exception 'gift_only_raise'; end if;
  insert into public.charges (user_id, challenge_id, kind, amount_cents, fee_cents)
    values (giver, challenge, 'gift', amount - current, 0)
    returning * into ch;
  return ch;
end $$;

-- 0062's, with a paid gift saved (or raised by what it added).
create or replace function public.card_charge_succeeded(charge uuid, intent text) returns text
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
    if found then return 'paid'; end if;
    update public.charges set error = 'challenge_gone' where id = charge;
    return 'refund';
  end if;
  begin
    if ch.kind = 'gift' then
      insert into public.extra_gifts (challenge_id, giver_id, amount_cents) values (ch.challenge_id, ch.user_id, ch.amount_cents)
        on conflict (challenge_id, giver_id) do update set amount_cents = public.extra_gifts.amount_cents + excluded.amount_cents;
    elsif (ch.pledge->>'raise')::boolean then
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

revoke execute on function public.check_gift(uuid, int), public.gift_charge(uuid, uuid, int), public.card_charge_succeeded(uuid, text)
  from public, anon, authenticated;
grant execute on function public.check_gift(uuid, int) to authenticated;
grant execute on function public.gift_charge(uuid, uuid, int), public.card_charge_succeeded(uuid, text) to service_role;
