-- Public challenges and Discover (T44; SPEC-pledges.md decisions 6 and 7). The challenger can turn
-- `is_public` off while a challenge runs, and on again only during its first 7 days (backers can't
-- pledge after that). discover_challenges() gives anyone signed in other users' running public
-- challenges, only their progress: username and photo, habit, day and length, check-in statuses
-- (for the shields), charity and pledge total. Never the challenges table itself, a profile, a
-- completion rate, a stake, date of birth or state. A backer who already pledged keeps seeing the
-- challenge after it's made private. Approving check-ins stays with friends (can_review, 0014).
-- Must match src/lib/pledges.ts. Proven by supabase/tests/pledges_rls.sql.

grant update (is_public) on public.challenges to authenticated;

-- A challenge can be opened to backers only while it runs and until the end of Day 7. The owner
-- (dashboard) isn't `authenticated` and can change it any time.
create function public.challenges_public_rule() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if (select auth.role()) = 'authenticated' and new.is_public and not old.is_public
     and (old.outcome is not null or public.challenge_day(old) > 7) then
    raise exception 'public_too_late';
  end if;
  return new;
end $$;

create trigger challenges_public_rule before update of is_public on public.challenges
  for each row execute function public.challenges_public_rule();

-- Other users' running public challenges (or one of them, by id), newest first, plus any the
-- caller backed as a backer that have since been made private.
create function public.discover_challenges(challenge uuid default null)
  returns table (id uuid, username text, avatar_path text, habit_id text, habit text, language text, level text,
                 length_days int, start_date date, time_zone text, day_offset int, charity text,
                 check_ins jsonb, total_cents int, pledgers int)
  language sql stable security definer set search_path = ''
  as $$
    select c.id, pr.username, pr.avatar_path, c.habit_id, h.name, c.language, c.level,
           c.length_days, c.start_date, c.time_zone, c.day_offset, ch.name,
           coalesce((select jsonb_agg(jsonb_build_object('day', ci.day, 'status', ci.status) order by ci.day)
                     from public.check_ins ci where ci.challenge_id = c.id), '[]'::jsonb),
           coalesce((select sum(p.amount_cents) from public.pledges p where p.challenge_id = c.id), 0)::int,
           (select count(*) from public.pledges p where p.challenge_id = c.id)::int
    from public.challenges c
    join public.profiles pr on pr.id = c.user_id
    join public.habits h on h.id = c.habit_id
    join public.charities ch on ch.id = c.charity_id
    where c.outcome is null
      and c.user_id <> (select auth.uid())
      and (challenge is null or c.id = challenge)
      and (c.is_public or exists (
        select 1 from public.pledges mine
        where mine.challenge_id = c.id and mine.pledger_id = (select auth.uid()) and mine.kind = 'backer'
      ))
    order by c.created_at desc
  $$;

revoke execute on function public.challenges_public_rule() from public, anon, authenticated;
revoke execute on function public.discover_challenges(uuid) from public, anon;
grant execute on function public.discover_challenges(uuid) to authenticated;
