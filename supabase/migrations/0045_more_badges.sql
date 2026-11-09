-- More badges and secret ones (owner, 2026-10-03; tasks/plan.md decision 79): badge_shares(), 0042's
-- SQL twin of badgesFor() in src/lib/badges.ts, again with every badge. New: Century (100 days or
-- more), High stakes ($100 or more on it), In the open (a public challenge), Two at once (two that ran
-- at the same time), Always there (back five friends past Day 1), and four secret ones, the hard
-- ones: Clean sweep (five finishes without a missed day), Full range (six different habits), Against
-- the odds (a finish after all three revival shields) and Patron (five strangers backed to a finish).
-- Ten kept and A full year turn secret too. Which badges are secret is the app's to show; the counts
-- here are the same for every badge. Aggregates only, as before; badges.test.ts checks every badge id
-- is listed in the newest migration that defines this function.

-- ponytail: scans every challenge on each call; fine for the demo, cache it (a nightly table) when the
-- Badges page gets slow.
create or replace function public.badge_shares()
  returns table (badge_id text, holders int, users int)
  language sql stable security definer set search_path = ''
  as $$
    with counted as (
      -- Money was on it: ended (never cancelled), or running past Day 1.
      select c.id, c.user_id, c.habit_id, c.length_days, c.stake_cents, c.outcome, c.ended_on_day,
             c.is_public, c.start_date,
             c.start_date + coalesce(c.ended_on_day, 1) - 1 as ended_on,
             (select count(*) from public.shield_purchases s where s.challenge_id = c.id) as bought
      from public.challenges c
      where c.outcome in ('finished', 'not_finished') or (c.outcome is null and public.challenge_day(c) > 1)
    ),
    fin as (select * from counted where outcome = 'finished'),
    fell as (select * from counted where outcome = 'not_finished'),
    supporter as (
      select p.pledger_id as user_id from public.pledges p join counted k on k.id = p.challenge_id where p.kind = 'supporter'
    ),
    backer as (
      select p.pledger_id as user_id from public.pledges p join public.challenges c on c.id = p.challenge_id
      where p.kind = 'backer' and c.outcome = 'finished'
    ),
    held (user_id, badge_id) as (
                select user_id, 'first-step'::text from counted
      union     select k.user_id, 'first-check-in' from counted k
                  join public.check_ins ci on ci.challenge_id = k.id and ci.status in ('approved', 'excused')
      union     select user_id, 'kept-it' from fin
      -- No missed day: it ended on the day its length came up.
      union     select user_id, 'unbroken' from fin where ended_on_day = length_days
      union     select user_id, 'hat-trick' from fin group by user_id having count(*) >= 3
      union     select user_id, 'long-haul' from fin where length_days >= 56
      union     select user_id, 'century' from fin where length_days >= 100
      union     select user_id, 'high-stakes' from fin where stake_cents >= 10000
      union     select user_id, 'in-the-open' from fin where is_public
      -- One ended on or after the other's Day 1.
      union     select a.user_id, 'two-at-once' from fin a
                  join fin b on b.user_id = a.user_id and b.id <> a.id and a.ended_on <= b.ended_on and a.ended_on >= b.start_date
      union     select user_id, 'it-stuck' from fin group by user_id, habit_id having count(*) >= 2
      union     select user_id, 'well-rounded' from fin group by user_id having count(distinct habit_id) >= 3
      union     select user_id, 'first-fall' from fell
      union     select f.user_id, 'back-on-your-feet' from fin f
                  where f.ended_on > (select min(x.ended_on) from fell x where x.user_id = f.user_id)
      -- Two or more missed days: both starting shields broke.
      union     select user_id, 'close-call' from fin where ended_on_day - length_days >= 2
      union     select f.user_id, 'unfinished-business' from fin f
                  join fell x on x.user_id = f.user_id and x.habit_id = f.habit_id and x.ended_on < f.ended_on
      union     select user_id, 'second-wind' from fin where bought > 0
      union     select user_id, 'good-for-a-cause' from fell group by user_id having sum(stake_cents) >= 10000
      union     select user_id, 'in-your-corner' from supporter
      union     select user_id, 'always-there' from supporter group by user_id having count(*) >= 5
      union     select user_id, 'paying-it-forward' from backer
      -- Secret.
      union     select user_id, 'ten-kept' from fin group by user_id having count(*) >= 10
      union     select user_id, 'full-year' from fin where length_days >= 365
      union     select user_id, 'clean-sweep' from fin where ended_on_day = length_days group by user_id having count(*) >= 5
      union     select user_id, 'full-range' from fin group by user_id having count(distinct habit_id) >= 6
      union     select user_id, 'against-the-odds' from fin where bought >= 3
      union     select user_id, 'patron' from backer group by user_id having count(*) >= 5
    )
    select b.id,
           (select count(*)::int from held h where h.badge_id = b.id),
           (select count(*)::int from public.profiles)
    from unnest(array[
      'first-step', 'first-check-in', 'kept-it', 'unbroken', 'hat-trick', 'long-haul', 'century',
      'high-stakes', 'in-the-open', 'two-at-once', 'it-stuck', 'well-rounded', 'first-fall',
      'back-on-your-feet', 'close-call', 'unfinished-business', 'second-wind', 'good-for-a-cause',
      'in-your-corner', 'always-there', 'paying-it-forward', 'ten-kept', 'full-year', 'clean-sweep',
      'full-range', 'against-the-odds', 'patron'
    ]) as b(id)
  $$;

-- create or replace keeps 0042's grants (authenticated only, never anon).
