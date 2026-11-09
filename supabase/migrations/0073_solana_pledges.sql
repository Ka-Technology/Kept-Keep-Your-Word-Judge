-- Solana S4, pledges paid in crypto (T171; SPEC-pledges.md, SPEC-payments.md "Solana"). A friend backing a
-- challenge paid in crypto can pay their pledge and its fee up front from their wallet, like a stake, in the
-- challenger's own token (decision 147: no swapping until T191; a card challenge takes no crypto pledges).
--   - start_crypto_pledge() checks the pledge as the pledger (check_pledge(), every pledge rule), prices it (a new
--     pledge, or a raise's difference and the fee's) and writes an awaiting `solana_payments` row of kind
--     'pledge', which `solana-pay` turns into the wallet's transfer (`?payment=<id>`). Only one waits at a time:
--     an unasked one is replaced, one a wallet already fetched refuses (`pledge_payment_waiting`).
--   - The pledge counts only once paid: solana_payment_confirmed() saves (or raises) it then. One that breaks a
--     rule by then (the challenge ended, a limit filled) is sent back whole, fee too, as a `return` payout.
--     Unpaid, it expires after 15 minutes like a stake's, and nothing was taken.
--   - At the end each pledge payment becomes a payout, alongside the stake's (0072): finished, a `reward` to the
--     challenger's wallet, or a `donation` if its pledger chose the charity; not finished, a `return` to the
--     pledger's wallet unless they chose to donate either way; cancelled, a `return`. Withdrawn by the end of
--     Day 1, a `return`. Kept's fee stays.
-- A payment's `stake_cents` is the pledge's part of it for a pledge payment.
-- Proven by supabase/tests/solana_pledges_rls.sql.

alter table public.solana_payments
  add column kind   text not null default 'stake' check (kind in ('stake', 'pledge')),
  -- A pledge's choices, applied once it's paid: { amount_cents (the new total), raise, donate_if_not_finished, to_charity_on_finish }.
  add column pledge jsonb,
  add constraint solana_payments_pledge_choices check ((kind = 'pledge') = (pledge is not null));
-- One stake payment per challenge; any number of pledge payments.
alter table public.solana_payments drop constraint solana_payments_challenge_id_key;
create unique index solana_payments_stake_challenge on public.solana_payments (challenge_id) where kind = 'stake';
create index solana_payments_challenge_id on public.solana_payments (challenge_id);

-- ── Paying a pledge ───────────────────────────────────────────────────────────────────────────────

create function public.start_crypto_pledge(challenge uuid, amount int, donate boolean, to_charity boolean) returns uuid
  language plpgsql security definer set search_path = ''
  as $$
declare
  c public.challenges;
  current int;
  waiting public.solana_payments;
  new_id uuid;
begin
  select * into c from public.challenges where challenges.id = challenge;
  if not found or c.pay_token is null then raise exception 'pledge_crypto_challenge_only'; end if;
  -- One payment at a time: a new ask replaces one no wallet has fetched yet.
  select * into waiting from public.solana_payments p
    where p.challenge_id = challenge and p.user_id = (select auth.uid()) and p.kind = 'pledge' and p.status = 'awaiting';
  if found and waiting.requested_at is not null then raise exception 'pledge_payment_waiting'; end if;
  if found then delete from public.solana_payments where solana_payments.id = waiting.id; end if;
  -- Every rule a pledge has, as the pledger (auth.uid()), undone.
  perform public.check_pledge(challenge, amount);
  select p.amount_cents into current from public.pledges p where p.challenge_id = challenge and p.pledger_id = (select auth.uid());
  -- Not coalesce(service_fee_cents(current)): least() skips a null, so the fee of no pledge would be the cap.
  insert into public.solana_payments (user_id, challenge_id, kind, token, stake_cents, fee_cents, pledge)
    values ((select auth.uid()), challenge, 'pledge', c.pay_token, amount - coalesce(current, 0),
            public.service_fee_cents(amount) - case when current is null then 0 else public.service_fee_cents(current) end,
            jsonb_build_object('amount_cents', amount, 'raise', current is not null,
                               'donate_if_not_finished', donate, 'to_charity_on_finish', to_charity))
    returning solana_payments.id into new_id;
  return new_id;
end $$;

-- 0056's, with a pledge payment saving its pledge, or going back whole when it can't count.
create or replace function public.solana_payment_confirmed(payment uuid, sig text, wallet text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  p public.solana_payments;
begin
  update public.solana_payments
    set status = 'confirmed', signature = sig, payer = wallet, confirmed_at = now()
    where id = payment and status = 'awaiting'
    returning * into p;
  if not found or p.challenge_id is null then return; end if;
  if p.kind = 'stake' then
    update public.challenges set payment_status = 'paid' where id = p.challenge_id;
    perform public.call_notify(jsonb_build_object('solana_payment', payment));
    return;
  end if;
  begin
    if (p.pledge->>'raise')::boolean then
      update public.pledges set amount_cents = (p.pledge->>'amount_cents')::int
        where challenge_id = p.challenge_id and pledger_id = p.user_id;
      if not found then raise exception 'pledge_gone'; end if;
    else
      insert into public.pledges (challenge_id, pledger_id, amount_cents, donate_if_not_finished, to_charity_on_finish)
        values (p.challenge_id, p.user_id, p.stake_cents,
                (p.pledge->>'donate_if_not_finished')::boolean, (p.pledge->>'to_charity_on_finish')::boolean);
    end if;
  exception when others then
    insert into public.solana_payouts (payment_id, user_id, challenge_id, kind, to_wallet, token, amount_cents)
      values (p.id, p.user_id, p.challenge_id, 'return', wallet, p.token, p.stake_cents + p.fee_cents);
    perform public.call_solana_payouts();
  end;
end $$;

-- ── At the end, and on a withdrawal ───────────────────────────────────────────────────────────────

-- 0072's, for pledge payments too. A pledge's choices are read from the pledge itself, as they stand now.
create or replace function public.record_solana_payouts(challenge uuid) returns void
  language sql security definer set search_path = ''
  as $$
    -- A cleared outcome takes back what the ending owed, not a withdrawn pledge's return.
    with gone as (
      delete from public.solana_payouts o using public.challenges c, public.solana_payments p
      where o.challenge_id = challenge and c.id = challenge and c.outcome is null and o.status = 'due' and p.id = o.payment_id
        and (p.kind = 'stake' or exists (select 1 from public.pledges pl where pl.challenge_id = p.challenge_id and pl.pledger_id = p.user_id))
    ),
    owed as (
      -- The stake.
      select p.id as payment_id, p.user_id, case when c.outcome = 'not_finished' then 'donation' else 'return' end as kind,
             case when c.outcome = 'not_finished' then null else p.payer end as to_wallet, p.token, p.stake_cents as amount_cents
      from public.challenges c join public.solana_payments p on p.challenge_id = c.id and p.status = 'confirmed' and p.kind = 'stake'
      where c.id = challenge and c.outcome is not null
      union all
      -- Each payment of a pledge that stands.
      select p.id,
             case when c.outcome = 'finished' and not pl.to_charity_on_finish then c.user_id else p.user_id end,
             case when c.outcome = 'finished' then case when pl.to_charity_on_finish then 'donation' else 'reward' end
                  when c.outcome = 'not_finished' and pl.donate_if_not_finished then 'donation'
                  else 'return' end,
             case when c.outcome = 'finished' and pl.to_charity_on_finish then null
                  when c.outcome = 'finished' then (select s.payer from public.solana_payments s where s.challenge_id = c.id and s.kind = 'stake' and s.status = 'confirmed')
                  when c.outcome = 'not_finished' and pl.donate_if_not_finished then null
                  else p.payer end,
             p.token, p.stake_cents
      from public.challenges c
      join public.solana_payments p on p.challenge_id = c.id and p.status = 'confirmed' and p.kind = 'pledge'
      join public.pledges pl on pl.challenge_id = c.id and pl.pledger_id = p.user_id
      where c.id = challenge and c.outcome is not null
    )
    insert into public.solana_payouts (payment_id, user_id, challenge_id, kind, to_wallet, token, amount_cents)
    select owed.payment_id, owed.user_id, challenge, owed.kind, owed.to_wallet, owed.token, owed.amount_cents from owed
    on conflict (payment_id) do update set user_id = excluded.user_id, kind = excluded.kind, to_wallet = excluded.to_wallet
      where public.solana_payouts.status = 'due'
  $$;

-- A crypto pledge withdrawn while its challenge runs (by the end of Day 1, or a bank's take-back, T194): each of
-- its payments goes back to the wallet that paid it, the fee kept.
create function public.pledges_solana_return() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if not exists (select 1 from public.challenges where id = old.challenge_id and outcome is null) then return null; end if;
  insert into public.solana_payouts (payment_id, user_id, challenge_id, kind, to_wallet, token, amount_cents)
    select p.id, p.user_id, p.challenge_id, 'return', p.payer, p.token, p.stake_cents
    from public.solana_payments p
    where p.challenge_id = old.challenge_id and p.user_id = old.pledger_id and p.kind = 'pledge' and p.status = 'confirmed'
    on conflict (payment_id) do nothing;
  if found then perform public.call_solana_payouts(); end if;
  return null;
end $$;
create trigger pledges_solana_return after delete on public.pledges
  for each row execute function public.pledges_solana_return();

revoke execute on function public.start_crypto_pledge(uuid, int, boolean, boolean), public.solana_payment_confirmed(uuid, text, text),
  public.record_solana_payouts(uuid), public.pledges_solana_return()
  from public, anon, authenticated;
grant execute on function public.start_crypto_pledge(uuid, int, boolean, boolean) to authenticated;
grant execute on function public.solana_payment_confirmed(uuid, text, text) to service_role;
