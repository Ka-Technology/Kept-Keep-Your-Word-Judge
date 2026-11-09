-- Free habit trackers (owner, 2026-10-01; SPEC-trackers.md). Any signed-in user can track a habit
-- for free: no money, no photo, no AI, no friends. They name it (any habit, through the word filter),
-- choose an open-ended streak or a goal of N days, and 0 to 3 shields, then tap Done for today or
-- yesterday. Private: only the user reads their trackers and days, and they don't count toward the
-- completion rate. Must match src/lib/trackers.ts. Proven by supabase/tests/trackers_rls.sql.

create table public.trackers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  -- Null: an open-ended streak. Otherwise the completed days that finish it.
  goal_days   int  check (goal_days between 1 and 365),
  shields     int  not null default 0 check (shields between 0 and 3),
  -- The creating phone's IANA zone, kept for good, as for challenges.
  time_zone   text not null,
  -- Day 1: the day it was made (set by the insert trigger). Nothing to stake, so no waiting a day.
  start_date  date not null,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create index trackers_user_id on public.trackers (user_id);

create table public.tracker_days (
  tracker_id uuid not null references public.trackers on delete cascade,
  day        date not null,
  created_at timestamptz not null default now(),
  primary key (tracker_id, day)
);

-- Before each tracker: a real time zone, Day 1 today, a name that passes the word filter, and at
-- most 50 running per person.
create function public.trackers_before_insert() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception 'invalid_time_zone' using errcode = '22023';
  end if;
  if public.objectionable(new.name) then raise exception 'text_objectionable' using errcode = '23514'; end if;
  if (select count(*) from public.trackers t where t.user_id = new.user_id and t.archived_at is null) >= 50 then
    raise exception 'tracker_limit' using errcode = '23514';
  end if;
  new.name := btrim(new.name);
  new.start_date := (now() at time zone new.time_zone)::date;
  new.created_at := now();
  return new;
end $$;

create trigger trackers_before_insert before insert on public.trackers
  for each row execute function public.trackers_before_insert();

-- A day is logged only for today or yesterday in the tracker's zone, from its first day, while it isn't archived.
create function public.tracker_days_before_insert() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  t public.trackers;
  today date;
begin
  select * into t from public.trackers where id = new.tracker_id;
  today := (now() at time zone t.time_zone)::date;
  if t.id is null or t.archived_at is not null or new.day < t.start_date or new.day not in (today, today - 1) then
    raise exception 'tracker_day_not_allowed' using errcode = '23514';
  end if;
  new.created_at := now();
  return new;
end $$;

create trigger tracker_days_before_insert before insert on public.tracker_days
  for each row execute function public.tracker_days_before_insert();

alter table public.trackers enable row level security;
alter table public.tracker_days enable row level security;
revoke all on public.trackers, public.tracker_days from anon, authenticated;

grant select on public.trackers to authenticated;
grant insert (name, goal_days, shields, time_zone) on public.trackers to authenticated;
grant update (archived_at) on public.trackers to authenticated;
grant select, delete on public.tracker_days to authenticated;
grant insert (tracker_id, day) on public.tracker_days to authenticated;

create policy "own trackers read" on public.trackers for select to authenticated using (user_id = (select auth.uid()));
create policy "own trackers create" on public.trackers for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own trackers archive" on public.trackers for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own tracker days read" on public.tracker_days for select to authenticated
  using (exists (select 1 from public.trackers t where t.id = tracker_id and t.user_id = (select auth.uid())));
create policy "own tracker days log" on public.tracker_days for insert to authenticated
  with check (exists (select 1 from public.trackers t where t.id = tracker_id and t.user_id = (select auth.uid())));
-- Undo a mis-tap: only today or yesterday, like logging.
create policy "own tracker days undo" on public.tracker_days for delete to authenticated
  using (exists (select 1 from public.trackers t
                 where t.id = tracker_id and t.user_id = (select auth.uid())
                   and day >= (now() at time zone t.time_zone)::date - 1));

revoke execute on function public.trackers_before_insert(), public.tracker_days_before_insert() from public, anon, authenticated;
