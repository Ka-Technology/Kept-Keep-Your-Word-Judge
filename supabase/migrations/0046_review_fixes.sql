-- Fixes from the whole-codebase review (2026-10-04; SPEC.md "Security review", third pass):
--
-- 1. The AI answer is one-way. ai_allowed goes from null (never asked) to true or false, and can
--    switch between those, but never back to null: a challenger who set it back to null after
--    checking in had every unchecked day excused (0036's claim), with no friend or AI looking.
-- 2. The database sets when a challenge was signed (consented_at), not the app.
-- 3. Reports are limited to 10 an hour per person: each one pushes to the owner's phone (0035), so a
--    flood would bury a real 48-hour removal.
-- 4. badge_shares() counts missed days from the check-ins, like badgesFor() does, so a day the owner
--    restores on appeal stops counting against Unbroken, Close call and Clean sweep on both sides; and
--    Back on your feet joins each person's first fall once instead of scanning per finish.
-- 5. An index for the check-ins still being decided, which the review list and the AI job's claim
--    look up every 15 minutes.
--
-- Proven by supabase/tests/hardening_rls.sql (1-3) and badges_rls.sql (4).

-- 1 ──────────────────────────────────────────────────────────────────────────────────────────────
create function public.profiles_ai_choice_final() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if old.ai_allowed is not null and new.ai_allowed is null then
    raise exception 'ai_choice_final' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger profiles_ai_choice_final before update of ai_allowed on public.profiles
  for each row execute function public.profiles_ai_choice_final();

-- 2 ──────────────────────────────────────────────────────────────────────────────────────────────
create function public.challenges_consent_time() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.consented_at := now();
  return new;
end $$;

create trigger challenges_consent_time before insert on public.challenges
  for each row execute function public.challenges_consent_time();

-- 3 ──────────────────────────────────────────────────────────────────────────────────────────────
-- Definer, to count the reporter's own reports, which only the owner may read.
create function public.reports_rate_limit() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if (select count(*) from public.reports r
      where r.reporter_id = (select auth.uid()) and r.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'report_rate_limited' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger reports_rate_limit before insert on public.reports
  for each row execute function public.reports_rate_limit();

revoke execute on function public.profiles_ai_choice_final(), public.challenges_consent_time(), public.reports_rate_limit()
  from public, anon, authenticated;

-- 4 ──────────────────────────────────────────────────────────────────────────────────────────────
-- 0045's function, with misses counted from the check-ins and the first fall joined once.
-- ponytail: still a full scan per call; the app keeps one answer per session (use-badge-extras.ts).
-- Cache it in a table on a schedule when the Badges page gets slow.
create or replace function public.badge_shares()
  returns table (badge_id text, holders int, users int)
  language sql stable security definer set search_path = ''
  as $$
    with counted as (
      -- Money was on it: ended (never cancelled), or running past Day 1.
      select c.id, c.user_id, c.habit_id, c.length_days, c.stake_cents, c.outcome, c.ended_on_day,
             c.is_public, c.start_date,
             c.start_date + coalesce(c.ended_on_day, 1) - 1 as ended_on,
             (select count(*) from public.shield_purchases s where s.challenge_id = c.id) as bought,
             -- Missed days up to the ending: no check-in, or one rejected or under appeal.
             (select count(*) from generate_series(1, coalesce(c.ended_on_day, 0)) d
               where not exists (select 1 from public.check_ins ci
                                 where ci.challenge_id = c.id and ci.day = d and ci.status not in ('rejected', 'appealed'))) as misses
      from public.challenges c
      where c.outcome in ('finished', 'not_finished') or (c.outcome is null and public.challenge_day(c) > 1)
    ),
    fin as (select * from counted where outcome = 'finished'),
    fell as (select * from counted where outcome = 'not_finished'),
    first_fall as (select user_id, min(ended_on) as ended_on from fell group by user_id),
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
      union     select user_id, 'unbroken' from fin where misses = 0
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
      union     select f.user_id, 'back-on-your-feet' from fin f join first_fall x on x.user_id = f.user_id and f.ended_on > x.ended_on
      -- Both starting shields broke.
      union     select user_id, 'close-call' from fin where misses >= 2
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
      union     select user_id, 'clean-sweep' from fin where misses = 0 group by user_id having count(*) >= 5
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

-- 5 ──────────────────────────────────────────────────────────────────────────────────────────────
create index check_ins_open on public.check_ins (challenge_id) where status in ('pending', 'flagged', 'ai_checking');
