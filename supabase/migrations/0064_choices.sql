-- Two owner decisions of 2026-10-28 (plan.md decisions 149 and 150), and the results screen's money choice.
-- 1. Where a pledge goes on a finish (0060) can change for 24 hours after it's paid, not until the end of
--    Day 1, and never once the challenge has ended. my_pledges() says whether it still can (`choice_open`).
-- 2. Kept balance is a way to pay the person chooses, beside card and crypto, not something taken on its own:
--    a charge uses the balance only when asked (`use_balance`: a challenge signed with it, or a pledge paid
--    with it), and the card pays whatever the balance doesn't cover (0063's rules). Credits still come off
--    the fee by themselves: they only ever pay Kept's fee.
-- 3. my_money_back() names each payout's challenge, so its results screen can offer the choice right there.
-- Proven by supabase/tests/payouts_rls.sql and balance_rls.sql.

-- ── 1. The choice is open for 24 hours after paying ───────────────────────────────────────────────

create or replace function public.pledges_before_update() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if (select auth.role()) is distinct from 'authenticated' then return new; end if;
  if new.amount_cents < old.amount_cents then raise exception 'pledge_only_raise'; end if;
  if old.donate_if_not_finished and not new.donate_if_not_finished then raise exception 'pledge_donate_stays_on'; end if;
  if new.to_charity_on_finish is distinct from old.to_charity_on_finish
     and (old.created_at < now() - interval '24 hours'
          or (select outcome from public.challenges where id = new.challenge_id) is not null) then
    raise exception 'pledge_choice_fixed';
  end if;
  if new.amount_cents > old.amount_cents then
    if (select outcome from public.challenges where id = new.challenge_id) is not null then
      raise exception 'pledge_challenge_ended';
    end if;
    if (select coalesce(sum(p.amount_cents), 0) from public.pledges p join public.challenges pc on pc.id = p.challenge_id
        where p.pledger_id = new.pledger_id and pc.outcome is null) - old.amount_cents + new.amount_cents > 30000 then
      raise exception 'pledge_outstanding_limit';
    end if;
  end if;
  return new;
end $$;

drop function public.my_pledges();
create function public.my_pledges()
  returns table (challenge_id uuid, kind text, amount_cents int, donate_if_not_finished boolean, to_charity_on_finish boolean,
                 challenger text, habit text, charity text, outcome text, withdrawable boolean, choice_open boolean)
  language sql stable security definer set search_path = ''
  as $$
    select p.challenge_id, p.kind, p.amount_cents, p.donate_if_not_finished, p.to_charity_on_finish,
           case when p.kind = 'supporter' then pr.username end, h.name, ch.name, c.outcome,
           c.outcome is null and public.challenge_day(c) <= 1,
           c.outcome is null and p.created_at >= now() - interval '24 hours'
    from public.pledges p
    join public.challenges c on c.id = p.challenge_id
    join public.profiles pr on pr.id = c.user_id
    join public.habits h on h.id = c.habit_id
    join public.charities ch on ch.id = c.charity_id
    where p.pledger_id = (select auth.uid())
    order by p.created_at desc
  $$;

-- ── 2. Kept balance only when chosen ──────────────────────────────────────────────────────────────

alter table public.challenges
  add column use_balance boolean not null default false,
  add constraint challenges_use_balance_card check (not use_balance or pay_card);
grant insert (use_balance) on public.challenges to authenticated;

alter table public.charges add column use_balance boolean not null default false;

create or replace function public.challenges_card_charge() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  insert into public.charges (user_id, challenge_id, kind, amount_cents, fee_cents, use_balance)
    values (new.user_id, new.id, 'stake', new.stake_cents, public.service_fee_cents(new.stake_cents), new.use_balance);
  return null;
end $$;

-- 0063's, with the balance taken only when the charge asks for it.
create or replace function public.charges_apply_credits() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  card int;
begin
  perform pg_advisory_xact_lock(hashtext('kept-balance:' || new.user_id::text));
  new.balance_cents := case when new.use_balance then least(new.amount_cents, greatest(public.balance_cents(new.user_id), 0)) else 0 end;
  card := new.amount_cents - new.balance_cents;
  new.fee_cents := case when card = 0 then 0 else least(new.fee_cents, public.service_fee_cents(card)) end;
  new.credits_cents := least(new.fee_cents, greatest(public.credit_balance_cents(new.user_id), 0));
  if card > 0 and card + new.fee_cents - new.credits_cents < 50 then
    new.credits_cents := greatest(card + new.fee_cents - 50, 0);
  end if;
  return new;
end $$;

drop function public.pledge_charge(uuid, uuid, int, boolean, boolean);
create function public.pledge_charge(pledger uuid, challenge uuid, amount int, donate boolean, to_charity boolean, use_balance boolean default false)
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
  insert into public.charges (user_id, challenge_id, kind, amount_cents, fee_cents, pledge, use_balance)
    values (pledger, challenge, 'pledge', amount - coalesce(current, 0),
            public.service_fee_cents(amount) - case when current is null then 0 else public.service_fee_cents(current) end,
            jsonb_build_object('amount_cents', amount, 'raise', current is not null,
                               'donate_if_not_finished', donate, 'to_charity_on_finish', to_charity),
            pledge_charge.use_balance)
    returning * into ch;
  return ch;
end $$;

-- ── 3. The money choice on a challenge's results screen ───────────────────────────────────────────

drop function public.my_money_back();
create function public.my_money_back()
  returns table (id uuid, challenge_id uuid, kind text, source text, amount_cents int, habit text, created_at timestamptz)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, o.challenge_id, o.kind, o.source, o.amount_cents, o.habit, o.created_at
    from public.payouts o
    where o.user_id = (select auth.uid()) and o.status = 'due' and public.payout_backed(o)
    order by o.created_at
  $$;

revoke execute on function public.pledges_before_update(), public.challenges_card_charge(), public.charges_apply_credits(),
  public.pledge_charge(uuid, uuid, int, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.pledge_charge(uuid, uuid, int, boolean, boolean, boolean) to service_role;
revoke execute on function public.my_pledges(), public.my_money_back() from public, anon;
grant execute on function public.my_pledges(), public.my_money_back() to authenticated;
