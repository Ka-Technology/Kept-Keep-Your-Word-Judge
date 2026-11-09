-- Stakes locked in Kept's escrow program on devnet (T229, decision 178; SPEC-payments.md "S6").
-- When it can, solana-pay (T230) builds a stake's transaction against the escrow program instead of the treasury, and
-- writes two addresses on the payment: the stake's escrow account (a program address from the challenge id) and the
-- charity's account (one from the charity's id), the only place a failed stake can go. The fee still goes to the
-- treasury in the same transaction, and pledges and PYUSD stakes stay on the treasury.
--   1. solana_payments.escrow and .escrow_charity: written only by the server; users read their own rows, as before.
--   2. record_solana_payouts(): 0073's, with one change. An escrowed stake that ends not finished owes its donation
--      to escrow_charity, so the cron and solana-pay's payouts() settle it into the charity's account. A treasury
--      donation still waits with no address until Every.org's endpoint (decision 167).
--   3. delete_account(): 0072's, also counting a donation that has an address as money in Kept, so a challenger can't
--      delete their account to leave a failed stake unsettled and reclaim it once the escrow's timeout passes.
--   4. solana_reconciliation(): only the treasury's money. An escrowed stake's fee came into the treasury, its stake
--      didn't, and what the escrow pays out never left the treasury.

alter table public.solana_payments
  add column escrow text unique,
  add column escrow_charity text,
  add constraint solana_payments_escrow_pair check ((escrow is null) = (escrow_charity is null)),
  add constraint solana_payments_escrow_stake check (escrow is null or kind = 'stake');

-- 0073's, with the stake's donation going to its escrow's charity account.
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
      -- The stake. Not finished: to the charity's escrow account, or with no address yet on the treasury.
      select p.id as payment_id, p.user_id, case when c.outcome = 'not_finished' then 'donation' else 'return' end as kind,
             case when c.outcome = 'not_finished' then p.escrow_charity else p.payer end as to_wallet, p.token, p.stake_cents as amount_cents
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

-- 0072's, with a donation that has somewhere to go (an escrowed stake's) counted until it has gone.
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
     or exists (
       select 1 from public.solana_payouts s
       where s.user_id = auth.uid() and (s.kind <> 'donation' or s.to_wallet is not null) and s.status in ('due', 'sent')
     ) then
    raise exception 'money_in_kept' using errcode = 'P0001';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- Per token, in cents, the treasury's books (0072's): what came into it, what went out of it, and what it still owes.
-- An escrowed stake's fee is the treasury's; the stake, and its payout, are the escrow's.
create or replace function public.solana_reconciliation()
  returns table (token text, paid_in_cents bigint, paid_out_cents bigint, owed_cents bigint)
  language sql stable security definer set search_path = ''
  as $$
    select t.token,
           (select coalesce(sum(case when p.escrow is null then p.stake_cents + p.fee_cents else p.fee_cents end), 0)
              from public.solana_payments p where p.token = t.token and p.status = 'confirmed'),
           (select coalesce(sum(o.amount_cents), 0) from public.solana_payouts o join public.solana_payments p on p.id = o.payment_id
              where o.token = t.token and o.status = 'confirmed' and p.escrow is null),
           (select coalesce(sum(o.amount_cents), 0) from public.solana_payouts o join public.solana_payments p on p.id = o.payment_id
              where o.token = t.token and o.status in ('due', 'sent') and p.escrow is null)
    from (select distinct p.token from public.solana_payments p where p.status = 'confirmed') t
  $$;
