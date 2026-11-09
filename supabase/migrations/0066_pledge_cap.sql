-- At most $1,000 in pledges per challenge (T196; plan.md decision 155; SPEC-pledges.md decision 4). Once a
-- challenge has $1,000 in pledges it takes no more, and a raise can't take it past that: Kept can't yet tell
-- a stolen card from a real one well enough to let one challenge collect more. The insert and update rules
-- refuse it (`pledge_challenge_full`), and so check_pledge() does before a card is charged. A raise the
-- server applies after a card payment (card_charge_succeeded()) is held to it too, so a challenge that filled
-- up in the meantime refunds that payment whole. A lock per challenge keeps two pledges at once from both
-- fitting. Must match PLEDGE_LIMITS in src/lib/pledges.ts. Proven by supabase/tests/pledge_cap_rls.sql.

-- Refuses `extra` more cents on a challenge that would take it past $1,000 in pledges.
create function public.pledge_fits(challenge uuid, extra int) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform pg_advisory_xact_lock(hashtext('kept-pledges:' || challenge::text));
  if (select coalesce(sum(amount_cents), 0) from public.pledges where challenge_id = challenge) + extra > 100000 then
    raise exception 'pledge_challenge_full';
  end if;
end $$;

-- 0035's rule, plus the cap, checked last.
create or replace function public.pledges_before_insert() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  c public.challenges;
begin
  select * into c from public.challenges where id = new.challenge_id;
  if not found then raise exception 'pledge_no_challenge'; end if;
  if c.user_id = new.pledger_id then raise exception 'pledge_own_challenge'; end if;
  if public.blocked_between(new.pledger_id, c.user_id) then raise exception 'pledge_not_allowed'; end if;
  if c.outcome is not null then raise exception 'pledge_challenge_ended'; end if;
  if exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least(new.pledger_id, c.user_id)
      and greatest(f.requester_id, f.addressee_id) = greatest(new.pledger_id, c.user_id)
  ) then
    new.kind := 'supporter';
  elsif not c.is_public then
    raise exception 'pledge_not_friend';
  elsif public.challenge_day(c) > 7 then
    raise exception 'pledge_backer_window';
  else
    new.kind := 'backer';
  end if;
  if (select coalesce(sum(p.amount_cents), 0) from public.pledges p join public.challenges pc on pc.id = p.challenge_id
      where p.pledger_id = new.pledger_id and pc.outcome is null) + new.amount_cents > 30000 then
    raise exception 'pledge_outstanding_limit';
  end if;
  perform public.pledge_fits(new.challenge_id, new.amount_cents);
  new.created_at := now();
  return new;
end $$;

-- 0064's rules for the pledger, plus the cap on any raise, the server's included.
create or replace function public.pledges_before_update() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if (select auth.role()) = 'authenticated' then
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
  end if;
  if new.amount_cents > old.amount_cents then
    perform public.pledge_fits(new.challenge_id, new.amount_cents - old.amount_cents);
  end if;
  return new;
end $$;

revoke execute on function public.pledge_fits(uuid, int), public.pledges_before_insert(), public.pledges_before_update()
  from public, anon, authenticated;
