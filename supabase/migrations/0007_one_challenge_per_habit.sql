-- One running challenge per habit (owner, 2026-09-26); for Learn a language, one per language. A
-- challenge counts until its outcome is recorded; after that the same habit can start again.
-- Checked when a challenge is created (not a unique index), so challenges that already overlap
-- stay valid. Must match duplicateChallengeError() in src/lib/challenges.ts.

-- Before each new challenge: check the time zone, set Day 1, and enforce the stake limits and the
-- one-per-habit rule. Same order as the app: the minimum, the habit, the first-challenge cap, the total.
create or replace function public.challenges_before_insert() returns trigger
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

  if new.stake_cents < 1000 then
    raise exception 'stake_minimum' using errcode = '23514';
  end if;

  -- One insert at a time per user, so two quick inserts can't both slip past a rule.
  perform pg_advisory_xact_lock(hashtext('challenges:' || new.user_id::text));

  if exists (select 1 from public.challenges
             where user_id = new.user_id and outcome is null
               and habit_id = new.habit_id and language is not distinct from new.language) then
    raise exception 'duplicate_challenge' using errcode = '23514';
  end if;

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
