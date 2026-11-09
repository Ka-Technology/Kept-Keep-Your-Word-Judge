-- A nameless public list (owner, 2026-09-27; SPEC-pledges.md decision 7, revised). Discover now has
-- two groups: Friends (friends' running challenges, read through the challenges table as before) and
-- Public. discover_challenges() is the Public group only: other users' running public challenges
-- from people who aren't the caller's friends, plus any the caller backed as a backer. It never
-- says who the challenger is: no username, photo or id. my_pledges() likewise names the challenger
-- only on a supporter's pledge, so a backer's Wallet doesn't either. Both sides stay anonymous: the
-- challenger sees backers as "Backer A" (0022). Must match src/lib/pledges.ts. Proven by
-- supabase/tests/pledges_rls.sql.

drop function public.discover_challenges(uuid);

create function public.discover_challenges(challenge uuid default null)
  returns table (id uuid, habit_id text, habit text, language text, level text,
                 length_days int, start_date date, time_zone text, day_offset int, charity text,
                 check_ins jsonb, total_cents int, pledgers int)
  language sql stable security definer set search_path = ''
  as $$
    select c.id, c.habit_id, h.name, c.language, c.level,
           c.length_days, c.start_date, c.time_zone, c.day_offset, ch.name,
           coalesce((select jsonb_agg(jsonb_build_object('day', ci.day, 'status', ci.status) order by ci.day)
                     from public.check_ins ci where ci.challenge_id = c.id), '[]'::jsonb),
           coalesce((select sum(p.amount_cents) from public.pledges p where p.challenge_id = c.id), 0)::int,
           (select count(*) from public.pledges p where p.challenge_id = c.id)::int
    from public.challenges c
    join public.habits h on h.id = c.habit_id
    join public.charities ch on ch.id = c.charity_id
    where c.outcome is null
      and c.user_id <> (select auth.uid())
      and (challenge is null or c.id = challenge)
      and not exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and least(f.requester_id, f.addressee_id) = least((select auth.uid()), c.user_id)
          and greatest(f.requester_id, f.addressee_id) = greatest((select auth.uid()), c.user_id)
      )
      and (c.is_public or exists (
        select 1 from public.pledges mine
        where mine.challenge_id = c.id and mine.pledger_id = (select auth.uid()) and mine.kind = 'backer'
      ))
    order by c.created_at desc
  $$;

revoke execute on function public.discover_challenges(uuid) from public, anon;
grant execute on function public.discover_challenges(uuid) to authenticated;

-- 0022's Wallet list, naming the challenger only on a supporter's (a friend's) pledge.
create or replace function public.my_pledges()
  returns table (challenge_id uuid, kind text, amount_cents int, donate_if_not_finished boolean,
                 challenger text, habit text, charity text, outcome text, withdrawable boolean)
  language sql stable security definer set search_path = ''
  as $$
    select p.challenge_id, p.kind, p.amount_cents, p.donate_if_not_finished,
           case when p.kind = 'supporter' then pr.username end, h.name, ch.name, c.outcome,
           c.outcome is null and public.challenge_day(c) <= 1
    from public.pledges p
    join public.challenges c on c.id = p.challenge_id
    join public.profiles pr on pr.id = c.user_id
    join public.habits h on h.id = c.habit_id
    join public.charities ch on ch.id = c.charity_id
    where p.pledger_id = (select auth.uid())
    order by p.created_at desc
  $$;
