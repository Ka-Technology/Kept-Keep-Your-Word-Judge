-- The pledges module, part 1 (T31; SPEC-pledges.md, approved 2026-09-27). Friends (supporters)
-- pledge pretend money behind a running challenge that isn't theirs: whole dollars from $5 to
-- $100, one pledge each, and $300 pending per person. A pledge is only ever raised, "donate even
-- if they don't finish" is only ever turned on, and the pledger can withdraw it until the end of
-- the challenge's Day 1. Nobody reads another person's pledge rows: the challenger reads who backs
-- them through challenge_pledges(), friends read totals through pledge_summaries(), and pledgers
-- read their own through my_pledges() (Wallet), so a backer's id never reaches anyone (T45).
-- Also challenges.is_public, chosen on the sign step (T44's first part); changing it later comes
-- with T44. Must match src/lib/pledges.ts. Proven by supabase/tests/pledges_rls.sql and
-- rls_everywhere.sql.

alter table public.challenges add column is_public boolean not null default false;
grant insert (is_public) on public.challenges to authenticated;

create table public.pledges (
  id                     uuid primary key default gen_random_uuid(),
  challenge_id           uuid not null references public.challenges on delete cascade,
  pledger_id             uuid not null default auth.uid() references auth.users on delete cascade,
  -- 'supporter' (the challenger's friend) or 'backer' (T45). Set by the insert trigger, never the client.
  kind                   text not null check (kind in ('supporter', 'backer')),
  amount_cents           int  not null check (amount_cents between 500 and 10000 and amount_cents % 100 = 0),
  donate_if_not_finished boolean not null default false,
  created_at             timestamptz not null default now(),
  unique (challenge_id, pledger_id)
);
create index pledges_pledger_id on public.pledges (pledger_id);

alter table public.pledges enable row level security;

-- Before each pledge: a running challenge that isn't yours, from its challenger's friend, within
-- the $300 pending across challenges that haven't ended. Security definer so the checks see every
-- challenge the pledger has backed, even after an unfriending.
create function public.pledges_before_insert() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  c public.challenges;
begin
  select * into c from public.challenges where id = new.challenge_id;
  if not found then raise exception 'pledge_no_challenge'; end if;
  if c.user_id = new.pledger_id then raise exception 'pledge_own_challenge'; end if;
  if c.outcome is not null then raise exception 'pledge_challenge_ended'; end if;
  if exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least(new.pledger_id, c.user_id)
      and greatest(f.requester_id, f.addressee_id) = greatest(new.pledger_id, c.user_id)
  ) then
    new.kind := 'supporter';
  else
    -- Backers on public challenges arrive with T45.
    raise exception 'pledge_not_friend';
  end if;
  if (select coalesce(sum(p.amount_cents), 0) from public.pledges p join public.challenges pc on pc.id = p.challenge_id
      where p.pledger_id = new.pledger_id and pc.outcome is null) + new.amount_cents > 30000 then
    raise exception 'pledge_outstanding_limit';
  end if;
  new.created_at := now();
  return new;
end $$;

-- Before each change by a user: only raise the amount (on a running challenge, within $300), and
-- only turn "donate anyway" on. The column grants below keep everything else fixed. The owner
-- (dashboard) and server jobs aren't `authenticated` and can correct anything.
create function public.pledges_before_update() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if (select auth.role()) is distinct from 'authenticated' then return new; end if;
  if new.amount_cents < old.amount_cents then raise exception 'pledge_only_raise'; end if;
  if old.donate_if_not_finished and not new.donate_if_not_finished then raise exception 'pledge_donate_stays_on'; end if;
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

create trigger pledges_before_insert before insert on public.pledges
  for each row execute function public.pledges_before_insert();
create trigger pledges_before_update before update on public.pledges
  for each row execute function public.pledges_before_update();

-- Whether a pledge on this challenge can still be withdrawn: until the end of its Day 1.
create function public.pledge_withdrawable(challenge uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (select 1 from public.challenges c where c.id = challenge and c.outcome is null and public.challenge_day(c) <= 1)
  $$;

revoke all on public.pledges from anon, authenticated;
grant select, delete on public.pledges to authenticated;
grant insert (challenge_id, amount_cents, donate_if_not_finished) on public.pledges to authenticated;
grant update (amount_cents, donate_if_not_finished) on public.pledges to authenticated;

create policy "own pledges read" on public.pledges
  for select to authenticated using (pledger_id = (select auth.uid()));
create policy "pledge as yourself" on public.pledges
  for insert to authenticated with check (pledger_id = (select auth.uid()));
create policy "own pledges update" on public.pledges
  for update to authenticated using (pledger_id = (select auth.uid())) with check (pledger_id = (select auth.uid()));
create policy "withdraw until the end of Day 1" on public.pledges
  for delete to authenticated using (pledger_id = (select auth.uid()) and public.pledge_withdrawable(challenge_id));

-- For the challenger only: each pledge on their challenge, supporters by username and photo,
-- backers by letter in the order they pledged ("Backer A"), never by id or name (decision 8).
create function public.challenge_pledges(challenge uuid)
  returns table (kind text, username text, avatar_path text, backer text, amount_cents int, donate_if_not_finished boolean)
  language sql stable security definer set search_path = ''
  as $$
    select q.kind, q.username, q.avatar_path,
           case when q.kind = 'backer' then 'Backer ' || case when q.n <= 26 then chr(64 + q.n) else q.n::text end end,
           q.amount_cents, q.donate_if_not_finished
    from (
      select p.kind, p.amount_cents, p.donate_if_not_finished, p.created_at,
             case when p.kind = 'supporter' then pr.username end as username,
             case when p.kind = 'supporter' then pr.avatar_path end as avatar_path,
             row_number() over (partition by p.kind order by p.created_at, p.id)::int as n
      from public.pledges p
      join public.challenges c on c.id = p.challenge_id
      left join public.profiles pr on pr.id = p.pledger_id
      where p.challenge_id = challenge and c.user_id = (select auth.uid())
    ) q
    order by q.created_at
  $$;

-- The pledge total and count for each challenge the caller may see: their own, a friend's, or
-- one they pledged on. Nothing about who pledged what.
create function public.pledge_summaries(ids uuid[])
  returns table (challenge_id uuid, total_cents int, pledgers int)
  language sql stable security definer set search_path = ''
  as $$
    select c.id, coalesce(sum(p.amount_cents), 0)::int, count(p.id)::int
    from public.challenges c
    left join public.pledges p on p.challenge_id = c.id
    where c.id = any(ids)
      and (
        c.user_id = (select auth.uid())
        or exists (
          select 1 from public.friendships f
          where f.status = 'accepted'
            and least(f.requester_id, f.addressee_id) = least((select auth.uid()), c.user_id)
            and greatest(f.requester_id, f.addressee_id) = greatest((select auth.uid()), c.user_id)
        )
        or exists (select 1 from public.pledges mine where mine.challenge_id = c.id and mine.pledger_id = (select auth.uid()))
      )
    group by c.id
  $$;

-- Wallet: the caller's own pledges, newest first, with whose challenge each backs and how it
-- ended, readable even if the two are no longer friends.
create function public.my_pledges()
  returns table (challenge_id uuid, kind text, amount_cents int, donate_if_not_finished boolean,
                 challenger text, habit text, charity text, outcome text, withdrawable boolean)
  language sql stable security definer set search_path = ''
  as $$
    select p.challenge_id, p.kind, p.amount_cents, p.donate_if_not_finished,
           pr.username, h.name, ch.name, c.outcome,
           c.outcome is null and public.challenge_day(c) <= 1
    from public.pledges p
    join public.challenges c on c.id = p.challenge_id
    join public.profiles pr on pr.id = c.user_id
    join public.habits h on h.id = c.habit_id
    join public.charities ch on ch.id = c.charity_id
    where p.pledger_id = (select auth.uid())
    order by p.created_at desc
  $$;

revoke execute on function public.pledges_before_insert(), public.pledges_before_update() from public, anon, authenticated;
revoke execute on function public.pledge_withdrawable(uuid), public.challenge_pledges(uuid), public.pledge_summaries(uuid[]), public.my_pledges()
  from public, anon;
grant execute on function public.pledge_withdrawable(uuid), public.challenge_pledges(uuid), public.pledge_summaries(uuid[]), public.my_pledges()
  to authenticated;
