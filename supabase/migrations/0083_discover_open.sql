-- Discover lists only challenges a stranger can still back (T205, plan.md decision 172). An ending is written when
-- the challenger's own app opens (outcome, 0039), so a public challenge whose misses had run out stayed in the list
-- with nothing to tap, as Santosh found on 2026-10-30. The list now asks the check-ins, through challenge_progress()
-- (0039), whether it's still running, and keeps it only through Day 7, the backers' window (0025), unless the
-- caller already backs it and can still raise their pledge. Opened by id (the pledge screen), it's unchanged, so an
-- ended one can still say it has ended. At most 100, newest first.
-- Proven by supabase/tests/pledges_rls.sql.

create or replace function public.discover_challenges(challenge uuid default null)
  returns table (id uuid, habit_id text, habit text, language text, level text,
                 length_days int, start_date date, time_zone text, day_offset int, charity text,
                 check_ins jsonb, shield_purchases jsonb, total_cents int, pledgers int, charity_slug text)
  language sql stable security definer set search_path = ''
  as $$
    select c.id, c.habit_id, h.name, c.language, c.level,
           c.length_days, c.start_date, c.time_zone, c.day_offset, ch.name,
           coalesce((select jsonb_agg(jsonb_build_object('day', ci.day, 'status', ci.status) order by ci.day)
                     from public.check_ins ci where ci.challenge_id = c.id), '[]'::jsonb),
           coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'price_cents', s.price_cents) order by s.nth)
                     from public.shield_purchases s where s.challenge_id = c.id), '[]'::jsonb),
           coalesce((select sum(p.amount_cents) from public.pledges p where p.challenge_id = c.id), 0)::int,
           (select count(*) from public.pledges p where p.challenge_id = c.id)::int,
           ch.slug
    from public.challenges c
    join public.habits h on h.id = c.habit_id
    join public.charities ch on ch.id = c.charity_id
    where c.outcome is null
      and c.user_id <> (select auth.uid())
      and (challenge is null or c.id = challenge)
      and not public.blocked_between((select auth.uid()), c.user_id)
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
      and (challenge is not null or (
        (select p.outcome from public.challenge_progress(c) p) = 'active'
        and (public.challenge_day(c) <= 7 or exists (
          select 1 from public.pledges mine
          where mine.challenge_id = c.id and mine.pledger_id = (select auth.uid()) and mine.kind = 'backer'
        ))
      ))
    order by c.created_at desc
    -- ponytail: no paging; add it when Discover passes 100 open challenges.
    limit 100
  $$;
