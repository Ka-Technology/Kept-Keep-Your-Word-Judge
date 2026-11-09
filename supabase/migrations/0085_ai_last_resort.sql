-- Kept's AI as a last resort, with a ceiling per user (plan.md decision 180, T243; SPEC-verification.md).
-- 1. When the AI steps in is one setting per user (profiles.ai_from_minutes: 10:00 pm to midnight, 15 minutes
--    apart, in minutes after midnight; 10 pm by default), and ai_check_claim() takes a waiting photo check from
--    then, not from a fixed 10 pm. It also returns who the check-in belongs to, for the ceiling.
-- 2. The ceiling: every AI call goes in ai_usage, and ai_take() refuses past a user's allowance over a rolling
--    24 hours: 3 for each stake challenge of theirs that hasn't ended, at least 4 (ai_allowance(); the same two
--    numbers are in supabase/functions/_shared/ai-limit.ts). The allowance is checked and the call recorded
--    under one lock per user, so simultaneous calls can't both pass; a call that failed on Kept's side is
--    released (ai_release()). The first day in a challenge that goes over is excused, later ones are a miss the
--    user can appeal: ai_limit_day() says which: the first day to go over passes, and stays let through however often that day is asked about (ai_limit_passes).
-- 3. quiz_bank: the language quiz's questions and their right answers, written by the AI in batches and drawn
--    from without replacement (supabase/functions/_shared/bank.ts). Server only: no answer key ever reaches the app.
-- Only the service role uses any of this. Proven by supabase/tests/ai_last_resort_rls.sql.

-- 1. The step-in time

alter table public.profiles
  add column ai_from_minutes smallint not null default 1320
    check (ai_from_minutes between 1320 and 1440 and ai_from_minutes % 15 = 0);
grant update (ai_from_minutes) on public.profiles to authenticated;

-- 2. The ceiling

create table public.ai_usage (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind    text not null check (kind in ('photo', 'quiz_write', 'quiz_grade', 'bank')),
  at      timestamptz not null default now()
);
create index ai_usage_user_at on public.ai_usage (user_id, at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

create table public.ai_limit_passes (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  -- The challenge's day that went over the limit first, and was let through.
  day          int not null,
  used_at      timestamptz not null default now()
);
alter table public.ai_limit_passes enable row level security;
revoke all on public.ai_limit_passes from anon, authenticated;

-- AI calls a user may make in 24 hours: 3 for each stake challenge that hasn't ended (an outcome ends it,
-- cancelling included), and never fewer than 4, so one Read challenge survives a failed quiz attempt.
create function public.ai_allowance(uid uuid) returns int
  language sql stable set search_path = ''
  as $$
    select greatest(4, 3 * count(*))::int from public.challenges where user_id = uid and outcome is null
  $$;

-- Records one AI call and returns its id, or null when the user has used their allowance in the last 24 hours.
-- Housekeeping: a week of a user's history is plenty.
create function public.ai_take(uid uuid, what text) returns bigint
  language plpgsql set search_path = ''
  as $$
declare
  used int;
  call bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_take:' || uid::text, 0));
  select count(*) into used from public.ai_usage where user_id = uid and at > now() - interval '24 hours';
  if used >= public.ai_allowance(uid) then
    return null;
  end if;
  insert into public.ai_usage (user_id, kind) values (uid, what) returning id into call;
  delete from public.ai_usage where user_id = uid and at < now() - interval '7 days';
  return call;
end
$$;

-- A call Kept failed to make (Anthropic's error, a timeout) doesn't use up anyone's share.
create function public.ai_release(call bigint) returns void
  language sql set search_path = ''
  as $$
    delete from public.ai_usage where id = call
  $$;

-- Whether `on_day` of a challenge is the one that passes: the first day to go over the limit is let through, and
-- stays let through however many times that same day is asked about (a quiz refused in the evening, then the
-- deadline's decision); any other day after it is a miss to appeal.
create function public.ai_limit_day(challenge uuid, on_day int) returns boolean
  language plpgsql set search_path = ''
  as $$
declare
  passed int;
begin
  insert into public.ai_limit_passes (challenge_id, day) values (challenge, on_day) on conflict do nothing;
  select day into passed from public.ai_limit_passes where challenge_id = challenge;
  return passed = on_day;
end
$$;

-- 3. The language quiz's bank

create table public.quiz_bank (
  id           uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  batch        int not null check (batch >= 0),
  key          text not null check (key <> ''),
  kind         text not null check (kind in ('vocabulary', 'sentence', 'reading', 'listening')),
  prompt       text not null check (char_length(prompt) between 1 and 300),
  speak        text check (char_length(speak) <= 300),
  answer       text not null check (char_length(answer) between 1 and 100),
  accepted     text[] not null default '{}' check (cardinality(accepted) <= 8),
  tags         text[] not null default '{}' check (cardinality(tags) <= 6),
  used_at      timestamptz,
  created_at   timestamptz not null default now(),
  -- A word is in a challenge's bank once, however its question was worded.
  unique (challenge_id, key)
);
create index quiz_bank_unused on public.quiz_bank (challenge_id) where used_at is null;
alter table public.quiz_bank enable row level security;
revoke all on public.quiz_bank from anon, authenticated;

-- 4. One writer at a time for a check-in's quiz questions. The quiz function claims the check-in before it asks
-- the AI to write, so simultaneous requests make one AI call, and a slow one can't overwrite a quiz already
-- answered. The marker is its own column, since the quiz column is what the app reads to decide what to show;
-- a claim older than 60 seconds is stale (the function died), and the next request may take over.
alter table public.check_ins add column quiz_writing_at timestamptz;

create function public.quiz_claim_write(ci uuid) returns boolean
  language sql set search_path = ''
  as $$
    with claimed as (
      update public.check_ins set quiz_writing_at = now()
      where id = ci and status = 'pending' and (quiz_writing_at is null or quiz_writing_at < now() - interval '60 seconds')
      returning 1
    )
    select exists (select 1 from claimed)
  $$;

-- ai_check_claim() as in 0036, with two changes: a waiting photo check is taken from the user's own step-in
-- time (profiles.ai_from_minutes; midnight, 1440, never comes before the day ends), and it returns the user and
-- the challenge, which the ceiling needs. The returned columns change, so it's dropped and made again.
drop function public.ai_check_claim(uuid);
create function public.ai_check_claim(only_challenge uuid default null)
  returns table (id uuid, habit_id text, day int, photo_path text, photo_taken_at timestamptz, time_zone text,
                 flag_note text, retake_asked boolean, day_ended boolean, book text, quiz jsonb,
                 user_id uuid, challenge_id uuid)
  language sql set search_path = ''
  as $$
    update public.check_ins set status = 'excused'
      where status = 'ai_checking' and ai_checked_at < now() - interval '10 minutes';
    update public.check_ins ci set status = 'rejected'
      from public.challenges c
      where c.id = ci.challenge_id
        and (only_challenge is null or c.id = only_challenge)
        and ci.status = 'retake' and ci.day < public.challenge_day(c);
    update public.check_ins ci
      set status = case when p.ai_allowed is false then 'rejected' else 'excused' end,
          ai_reason = case when p.ai_allowed is false
                           then 'No friend who backs you approved this before the day ended, and you chose not to let Kept’s AI check your days.' end
      from public.challenges c join public.profiles p on p.id = c.user_id
      where c.id = ci.challenge_id
        and (only_challenge is null or c.id = only_challenge)
        and p.ai_allowed is not true
        and ci.status in ('pending', 'flagged')
        and ci.day < public.challenge_day(c);
    update public.check_ins ci set status = 'ai_checking'
      from public.challenges c join public.profiles p on p.id = c.user_id
      where c.id = ci.challenge_id
        and (only_challenge is null or c.id = only_challenge)
        and p.ai_allowed
        and ci.status in ('pending', 'flagged')
        and (ci.day < public.challenge_day(c)
             or ((extract(hour from now() at time zone c.time_zone) * 60 + extract(minute from now() at time zone c.time_zone)) >= p.ai_from_minutes
                 and c.habit_id not in ('read', 'language'))
             or (ci.status = 'pending' and ci.retake_asked))
      returning ci.id, c.habit_id, ci.day, ci.photo_path, ci.photo_taken_at, c.time_zone, ci.flag_note,
                ci.retake_asked, ci.day < public.challenge_day(c), ci.book, ci.quiz, c.user_id, c.id;
  $$;

revoke execute on function public.ai_check_claim(uuid), public.ai_allowance(uuid), public.ai_take(uuid, text),
  public.ai_release(bigint), public.ai_limit_day(uuid, int), public.quiz_claim_write(uuid) from public, anon, authenticated;
grant execute on function public.ai_check_claim(uuid), public.ai_allowance(uuid), public.ai_take(uuid, text),
  public.ai_release(bigint), public.ai_limit_day(uuid, int), public.quiz_claim_write(uuid) to service_role;
