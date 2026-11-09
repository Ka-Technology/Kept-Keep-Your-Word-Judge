-- The challenges module (SPEC-challenges.md, T16): Kept's charity and habit lists, challenges and
-- their daily check-ins. The stake limits are enforced here as well as in the app
-- (src/lib/challenges.ts mirrors them, tested against this file).

-- Lists Kept vets. Read-only in the app; seeded at the end of this file.
create table public.charities (
  id       text primary key,
  name     text not null,
  purpose  text not null,
  position int  not null
);

create table public.habits (
  id            text primary key,
  name          text not null,
  check_summary text not null,
  position      int  not null
);

create table public.challenges (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id       text not null references public.habits(id),
  language       text check (language in ('spanish', 'french', 'german', 'italian', 'portuguese', 'japanese', 'korean', 'mandarin')),
  level          text check (level in ('beginner', 'intermediate', 'advanced')),
  length_days    int  not null check (length_days in (28, 42, 56)),
  stake_cents    int  not null check (stake_cents between 100 and 10000 and stake_cents % 100 = 0),
  charity_id     text not null references public.charities(id),
  -- Recorded only in the demo: nothing is charged.
  payment_method text not null check (payment_method in ('card', 'solana_usdc')),
  -- The creating phone's IANA zone, kept for good; each day ends at midnight there.
  time_zone      text not null,
  -- Day 1; set by challenges_before_insert() to the day after creation.
  start_date     date not null,
  consented_at   timestamptz not null,
  -- The demo clock ("Next day"). Remove this column and its grant before `payments`.
  day_offset     int  not null default 0 check (day_offset >= 0),
  outcome        text check (outcome in ('finished', 'not_finished')),
  ended_on_day   int  check (ended_on_day >= 1),
  ended_at       timestamptz,
  created_at     timestamptz not null default now(),
  -- Learn a language needs a language and a level; no other habit has them.
  constraint challenges_language_matches_habit check (
    case when habit_id = 'language' then language is not null and level is not null
         else language is null and level is null end
  ),
  -- An outcome is recorded together with the day and time it ended.
  constraint challenges_outcome_complete check (
    (outcome is null) = (ended_on_day is null) and (outcome is null) = (ended_at is null)
  )
);

create index challenges_user_id_idx on public.challenges (user_id);

create table public.check_ins (
  id           uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  day          int  not null check (day >= 1),
  -- Until `verification` (T25), a check-in counts as approved straight away (the T18 placeholder).
  -- T25 changes the default to 'pending'; the app can't set the status itself.
  status       text not null default 'approved' check (status in ('pending', 'approved', 'rejected', 'excused')),
  created_at   timestamptz not null default now(),
  unique (challenge_id, day)
);

-- The challenge's current day: 0 before Day 1, then calendar days in its own time zone, plus the
-- demo clock. Must agree with challengeDay() in src/lib/challenge-rules.ts.
create function public.challenge_day(c public.challenges) returns int
  language sql stable set search_path = ''
  as $$ select greatest(0, ((now() at time zone c.time_zone)::date + c.day_offset) - c.start_date + 1) $$;

-- Before each new challenge: check the time zone, set Day 1, and enforce the stake limits that
-- depend on the user's other challenges.
create function public.challenges_before_insert() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  earlier int;
  outstanding int;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception 'invalid_time_zone' using errcode = '22023';
  end if;
  new.start_date := (now() at time zone new.time_zone)::date + 1;

  -- One insert at a time per user, so two quick inserts can't both slip under a limit.
  perform pg_advisory_xact_lock(hashtext('challenges:' || new.user_id::text));
  select count(*), coalesce(sum(stake_cents) filter (where outcome is null), 0)
    into earlier, outstanding
    from public.challenges
    where user_id = new.user_id;
  if earlier = 0 and new.stake_cents > 2500 then
    raise exception 'first_challenge_stake_limit' using errcode = '23514';
  end if;
  if outstanding + new.stake_cents > 30000 then
    raise exception 'outstanding_stake_limit' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger challenges_before_insert before insert on public.challenges
  for each row execute function public.challenges_before_insert();

-- An outcome, once recorded, is final.
create function public.challenges_before_update() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if old.outcome is not null
     and (new.outcome, new.ended_on_day, new.ended_at) is distinct from (old.outcome, old.ended_on_day, old.ended_at) then
    raise exception 'outcome_is_final' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger challenges_before_update before update on public.challenges
  for each row execute function public.challenges_before_update();

-- App users check in only for a running challenge's current day. The owner (the dashboard, which
-- has no user JWT) can still add any day, e.g. an excused day after an appeal.
create function public.check_ins_before_insert() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  c public.challenges;
begin
  if (select auth.role()) = 'authenticated' then
    select * into c from public.challenges where id = new.challenge_id;
    if c.id is null or c.outcome is not null or new.day <> public.challenge_day(c) then
      raise exception 'check_in_not_today' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger check_ins_before_insert before insert on public.check_ins
  for each row execute function public.check_ins_before_insert();

-- Access. Friends' read access comes with `friends` (T21).
alter table public.charities  enable row level security;
alter table public.habits     enable row level security;
alter table public.challenges enable row level security;
alter table public.check_ins  enable row level security;

revoke all on public.charities, public.habits, public.challenges, public.check_ins from anon, authenticated;

grant select on public.charities, public.habits to authenticated;
create policy "read the charity list" on public.charities for select to authenticated using (true);
create policy "read the habit list" on public.habits for select to authenticated using (true);

-- The app sends only these columns; the rest come from defaults and the trigger.
grant select on public.challenges to authenticated;
grant insert (habit_id, language, level, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  on public.challenges to authenticated;
-- The app records the outcome it computes (until `payments` moves settlement to the server) and
-- moves the demo clock. Nothing else changes, and nothing is deleted except by delete_account().
grant update (outcome, ended_on_day, ended_at, day_offset) on public.challenges to authenticated;

create policy "own challenges read" on public.challenges
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own challenges create" on public.challenges
  for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles where id = (select auth.uid())));
create policy "own challenges update" on public.challenges
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select on public.check_ins to authenticated;
grant insert (challenge_id, day) on public.check_ins to authenticated;

create policy "own check-ins read" on public.check_ins
  for select to authenticated
  using (exists (select 1 from public.challenges c where c.id = challenge_id and c.user_id = (select auth.uid())));
create policy "own check-ins create" on public.check_ins
  for insert to authenticated
  with check (exists (select 1 from public.challenges c where c.id = challenge_id and c.user_id = (select auth.uid())));

revoke execute on function public.challenge_day(public.challenges) from public, anon;
grant execute on function public.challenge_day(public.challenges) to authenticated;

-- The lists (owner, 2026-09-25).
insert into public.charities (id, name, purpose, position) values
  ('msf', 'Doctors Without Borders', 'Emergency medical care for people caught in conflict, epidemics and disasters.', 1),
  ('st-jude', 'St. Jude Children''s Research Hospital', 'Treats and researches childhood cancer, and families never receive a bill.', 2),
  ('charity-water', 'charity: water', 'Clean, safe drinking water for communities in developing countries.', 3),
  ('feeding-america', 'Feeding America', 'A nationwide network of food banks fighting hunger in the US.', 4),
  ('nature-conservancy', 'The Nature Conservancy', 'Protects the lands and waters that nature and people depend on.', 5),
  ('aspca', 'ASPCA', 'Rescues animals and works to prevent cruelty to animals across the US.', 6),
  ('oceana', 'Oceana', 'Campaigns to protect and restore the world''s oceans.', 7),
  ('rare', 'Rare', 'Helps communities adopt habits that protect nature and the climate.', 8),
  ('catf', 'Clean Air Task Force', 'Pushes for the technology and policy needed to cut climate pollution.', 9),
  ('giving-green', 'Giving Green', 'Finds the most effective climate organizations; its fund supports its top picks.', 10),
  ('founders-pledge-climate', 'Founders Pledge Climate Fund', 'Backs high-impact climate work chosen by Founders Pledge''s researchers.', 11);

insert into public.habits (id, name, check_summary, position) values
  ('read', 'Read', 'Enter the pages you read, photograph the last one, then a quick AI quiz.', 1),
  ('language', 'Learn a language', 'A quick AI quiz in your language: words, sentences, reading and listening.', 2),
  ('workout', 'Work out', 'A photo of you at the gym or mid-workout.', 3),
  ('walk-run', 'Walk or run', 'A photo outdoors, or your tracker''s distance screen.', 4),
  ('cook', 'Cook at home', 'A photo mid-cooking: ingredients cooking on your stove.', 5),
  ('journal', 'Journal', 'Today''s page, with the date written on it.', 6),
  ('instrument', 'Practice an instrument', 'A photo of you playing.', 7),
  ('meditate', 'Meditate', 'Your meditation app''s session-finished screen.', 8),
  ('stretch', 'Stretch or yoga', 'A photo of you on the mat, mid-pose.', 9),
  ('study', 'Study', 'Your notes, or a course''s lesson-complete screen.', 10);
