-- Badges, part 2 (owner, 2026-10-03; tasks/plan.md decisions 27 and 75): choosing which badges lead
-- your profile, and each badge's share of Kept users, like Steam's achievements.
--
-- Badges are still worked out, never stored (badgesFor() in src/lib/badges.ts). The one new thing
-- kept is the showcase: up to three badge ids on the profile, in the order chosen. The app shows only
-- the ones the person really has, so a stale or forged id shows nothing.
--
-- badge_extras(person): what a person's challenges can't show, for them or an accepted friend: their
-- showcase, and the two pledge counts (backed strangers' finishes, backed friends' challenges past
-- Day 1). Replaces the app's use of backed_finished_count(), which stays for older builds.
--
-- badge_shares(): the SQL twin of badgesFor(). For every badge, how many people hold it, and how many
-- people use Kept. Aggregates only, no row says who. Endings are the server-checked ones (0039), so a
-- finish the app sees but hasn't recorded yet counts once it's recorded. Must match BADGES and
-- badgesFor(); badges.test.ts checks every badge id is listed here.

alter table public.profiles
  add column showcase_badges text[] not null default '{}'
    constraint profiles_showcase_badges_check check (
      cardinality(showcase_badges) <= 3
      and array_position(showcase_badges, null) is null
      and array_to_string(showcase_badges, ' ') ~ '^([a-z-]{1,40}( |$))*$'
    );

-- The own-row update policy is 0003's.
grant update (showcase_badges) on public.profiles to authenticated;

create function public.badge_extras(person uuid)
  returns table (showcase text[], backed int, supported int)
  language sql stable security definer set search_path = ''
  as $$
    select p.showcase_badges,
           (select count(*)::int from public.pledges pl join public.challenges c on c.id = pl.challenge_id
             where pl.pledger_id = person and pl.kind = 'backer' and c.outcome = 'finished'),
           -- Money was on it: past Day 1, when a pledge can no longer be withdrawn, and not cancelled.
           (select count(*)::int from public.pledges pl join public.challenges c on c.id = pl.challenge_id
             where pl.pledger_id = person and pl.kind = 'supporter'
               and (c.outcome in ('finished', 'not_finished') or (c.outcome is null and public.challenge_day(c) > 1)))
    from public.profiles p
    where p.id = person
      and (person = (select auth.uid()) or exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and least(f.requester_id, f.addressee_id) = least((select auth.uid()), person)
          and greatest(f.requester_id, f.addressee_id) = greatest((select auth.uid()), person)
      ))
  $$;

-- ponytail: scans every challenge on each call; fine for the demo, cache it (a nightly table) when the
-- Badges page gets slow.
create function public.badge_shares()
  returns table (badge_id text, holders int, users int)
  language sql stable security definer set search_path = ''
  as $$
    with counted as (
      -- Money was on it: ended (never cancelled), or running past Day 1.
      select c.id, c.user_id, c.habit_id, c.length_days, c.stake_cents, c.outcome, c.ended_on_day,
             c.start_date + coalesce(c.ended_on_day, 1) - 1 as ended_on,
             (select count(*) from public.shield_purchases s where s.challenge_id = c.id) as bought
      from public.challenges c
      where c.outcome in ('finished', 'not_finished') or (c.outcome is null and public.challenge_day(c) > 1)
    ),
    fin as (select * from counted where outcome = 'finished'),
    fell as (select * from counted where outcome = 'not_finished'),
    held (user_id, badge_id) as (
                select user_id, 'first-step'::text from counted
      union     select k.user_id, 'first-check-in' from counted k
                  join public.check_ins ci on ci.challenge_id = k.id and ci.status in ('approved', 'excused')
      union     select user_id, 'kept-it' from fin
      -- No missed day: it ended on the day its length came up.
      union     select user_id, 'unbroken' from fin where ended_on_day = length_days
      union     select user_id, 'hat-trick' from fin group by user_id having count(*) >= 3
      union     select user_id, 'long-haul' from fin where length_days >= 56
      union     select user_id, 'it-stuck' from fin group by user_id, habit_id having count(*) >= 2
      union     select user_id, 'well-rounded' from fin group by user_id having count(distinct habit_id) >= 3
      union     select user_id, 'ten-kept' from fin group by user_id having count(*) >= 10
      union     select user_id, 'full-year' from fin where length_days >= 365
      union     select user_id, 'first-fall' from fell
      union     select f.user_id, 'back-on-your-feet' from fin f
                  where f.ended_on > (select min(x.ended_on) from fell x where x.user_id = f.user_id)
      -- Two or more missed days: both starting shields broke.
      union     select user_id, 'close-call' from fin where ended_on_day - length_days >= 2
      union     select f.user_id, 'unfinished-business' from fin f
                  join fell x on x.user_id = f.user_id and x.habit_id = f.habit_id and x.ended_on < f.ended_on
      union     select user_id, 'second-wind' from fin where bought > 0
      union     select user_id, 'good-for-a-cause' from fell group by user_id having sum(stake_cents) >= 10000
      union     select p.pledger_id, 'in-your-corner' from public.pledges p
                  join counted k on k.id = p.challenge_id where p.kind = 'supporter'
      union     select p.pledger_id, 'paying-it-forward' from public.pledges p
                  join public.challenges c on c.id = p.challenge_id where p.kind = 'backer' and c.outcome = 'finished'
    )
    select b.id,
           (select count(*)::int from held h where h.badge_id = b.id),
           (select count(*)::int from public.profiles)
    from unnest(array[
      'first-step', 'first-check-in', 'kept-it', 'unbroken', 'hat-trick', 'long-haul', 'it-stuck',
      'well-rounded', 'ten-kept', 'full-year', 'first-fall', 'back-on-your-feet', 'close-call',
      'unfinished-business', 'second-wind', 'good-for-a-cause', 'in-your-corner', 'paying-it-forward'
    ]) as b(id)
  $$;

revoke execute on function public.badge_extras(uuid) from public, anon;
grant execute on function public.badge_extras(uuid) to authenticated;
revoke execute on function public.badge_shares() from public, anon;
grant execute on function public.badge_shares() to authenticated;
