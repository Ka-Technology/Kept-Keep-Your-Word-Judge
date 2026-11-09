-- Kept credits spent on the fee (T164; SPEC-payments.md "Kept credits spent on the fee"; SPEC-pledges.md
-- decision 9). A backer earns credits when their challenger finishes: creditsFor() in challenge-rules.ts,
-- 10% of the pledge, never more than its own fee. Before a card stake or pledge is charged, the database
-- takes what the person has left off its fee (charges.credits_cents, so total_cents is less). Credits on a
-- pending or paid charge are spent; a charge that failed or expired, or was refunded whole because nothing
-- was bought, gives them back. The app reads what's left with my_credits().
-- ponytail: two charges created in the same instant could both use the same credits; a per-user lock if it matters.
-- Proven by supabase/tests/credits_rls.sql.

-- Earned, less spent: the SQL twin of creditBalanceCents() in pledges.ts, minus the charges' credits. The
-- 10% backer rate mirrors CREDIT_RATES in challenge-rules.ts (supporters earn none); change both together.
create function public.credit_balance_cents(person uuid) returns int
  language sql stable security definer set search_path = ''
  as $$
    select (
      select coalesce(sum(least(floor(p.amount_cents * 0.1)::int, public.service_fee_cents(p.amount_cents))), 0)::int
      from public.pledges p join public.challenges c on c.id = p.challenge_id
      where p.pledger_id = person and p.kind = 'backer' and c.outcome = 'finished'
    ) - (
      select coalesce(sum(ch.credits_cents), 0)::int from public.charges ch
      where ch.user_id = person and (ch.status = 'pending' or (ch.status = 'succeeded' and ch.error is null))
    )
  $$;

-- The caller's credits left, for the fee lines before paying and Wallet.
create function public.my_credits() returns int
  language sql stable security definer set search_path = ''
  as $$ select public.credit_balance_cents((select auth.uid())) $$;

create function public.charges_apply_credits() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  new.credits_cents := least(new.fee_cents, greatest(public.credit_balance_cents(new.user_id), 0));
  return new;
end $$;
create trigger charges_apply_credits before insert on public.charges
  for each row execute function public.charges_apply_credits();

-- 0061's, with a stake that has nothing left to pay for marked too (`error`), so its credits come back.
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

revoke execute on function public.credit_balance_cents(uuid), public.charges_apply_credits(), public.card_charge_succeeded(uuid, text)
  from public, anon, authenticated;
grant execute on function public.card_charge_succeeded(uuid, text) to service_role;
revoke execute on function public.my_credits() from public, anon;
grant execute on function public.my_credits() to authenticated;
