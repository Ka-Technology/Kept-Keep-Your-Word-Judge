-- Stakes (owner, 2026-09-25): at least $10, with no maximum per challenge. The $25 cap on a first
-- challenge and the $300 total across unended challenges stay.
-- The $10 minimum is checked when a challenge is created (in the insert trigger), not as a column
-- check, so earlier challenges with smaller stakes stay valid and can still be updated.
-- Must match STAKE_LIMITS in src/lib/challenges.ts (tested in challenges.test.ts).
alter table public.challenges drop constraint challenges_stake_cents_check;
alter table public.challenges add constraint challenges_stake_cents_check check (stake_cents > 0 and stake_cents % 100 = 0);

-- Before each new challenge: check the time zone, set Day 1, and enforce the stake limits. Same
-- order as stakeError(): the minimum, then the first-challenge cap, then the total.
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
