-- Shields and endings (owner, 2026-10-01; SPEC-challenges.md "Shields, length and ending" and
-- "Revival shields"), and the security review's main finding: the app recorded a challenge's outcome
-- and the database took its word for it.
--
-- Two shields. Each miss breaks one; a miss with none left ends the challenge. That's the third
-- miss, as before (0004 said "3 shields, losing the third ends it"), so no running challenge changes.
--
-- Revival shields. When that ending miss comes, the challenger can buy a shield until the end of the
-- next day, and the challenge runs on. Up to 3 per challenge, at 20%, 40%, then 60% of the stake
-- (whole dollars, rounded up, at least $5). Half goes to the charity in the challenger's name and half
-- to Kept: the one place Kept earns from a miss (an exception to SPEC.md's money rule, for the
-- lawyer). Pretend money in the demo. Friends read each purchase with the challenge, and backers
-- through discover_challenges(), so everyone backing it sees which missed days were bought back.
--
-- Endings, server-side. challenge_progress() is the SQL twin of progress() in
-- src/lib/challenge-rules.ts. When the app records an ending, challenges_outcome_rule() refuses one
-- the check-ins don't support and sets ended_on_day and ended_at itself:
--   finished      only when the days reach the length, and only once every counted day is decided
--                 (a check-in still pending at the last midnight no longer finishes a challenge
--                 before the AI has looked at it);
--   not_finished  the day the misses ran out, or a quit from Day 2 on (today);
--   cancelled     until the end of Day 1 (0026's rule, which this replaces).
-- An outcome stays final (0019), except that buy_shield() reopens the challenge in the same
-- transaction that records the shield.
--
-- Must match progress(), shieldPriceCents() and shieldSplit() in src/lib/challenge-rules.ts.
-- Proven by supabase/tests/challenges_rls.sql and donations_rls.sql.

-- ── Revival shields ─────────────────────────────────────────────────────────────────────────────

create table public.shield_purchases (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenges on delete cascade,
  -- 1, 2 or 3: the challenge's first, second or third bought shield.
  nth           int  not null check (nth between 1 and 3),
  -- The missed day it covers: the miss that had ended the challenge.
  day           int  not null check (day >= 1),
  price_cents   int  not null check (price_cents >= 500 and price_cents % 100 = 0),
  charity_cents int  not null generated always as (price_cents / 2) stored,
  kept_cents    int  not null generated always as (price_cents / 2) stored,
  created_at    timestamptz not null default now(),
  unique (challenge_id, nth)
);

alter table public.shield_purchases enable row level security;
revoke all on public.shield_purchases from anon, authenticated;
grant select on public.shield_purchases to authenticated;

-- Readable whenever the challenge is: the challenger's own, or an accepted friend's (0012).
-- Written only by buy_shield().
create policy "read with the challenge" on public.shield_purchases
  for select to authenticated using (exists (select 1 from public.challenges c where c.id = challenge_id));

-- ── Where a challenge stands, server-side ───────────────────────────────────────────────────────

-- progress() in SQL: completed days, misses, shields left, and how it ended. Ended days count in
-- order: approved, excused, or still being checked when the day ended = done; anything else = a miss.
-- Two shields plus any bought; a miss with none left ends it. `under_review`: a day counted as done
-- is still being checked. Runs as the caller, so it sees only what they may read.
create function public.challenge_progress(c public.challenges)
  returns table (days_completed int, misses int, shields_left int, outcome text, ended_on_day int, under_review boolean)
  language plpgsql stable set search_path = ''
  as $$
declare
  today   int := public.challenge_day(c);
  shields int := 2 + (select count(*)::int from public.shield_purchases s where s.challenge_id = c.id);
  status  text[] := array(
    select ci.status from generate_series(1, greatest(today, 0)) g(n)
    left join public.check_ins ci on ci.challenge_id = c.id and ci.day = g.n
    order by g.n
  );
  checking text[] := array['pending', 'flagged', 'ai_checking', 'retake'];
  d int;
begin
  days_completed := 0;
  misses := 0;
  outcome := 'active';
  ended_on_day := null;
  under_review := false;
  for d in 1 .. today loop
    if status[d] in ('approved', 'excused') or (d < today and status[d] = any(checking)) then
      under_review := under_review or status[d] = any(checking);
      days_completed := days_completed + 1;
      if days_completed = c.length_days then
        outcome := 'finished';
        ended_on_day := d;
        exit;
      end if;
    elsif d < today then
      misses := misses + 1;
      if misses > shields then
        outcome := 'not_finished';
        ended_on_day := d;
        exit;
      end if;
    end if;
  end loop;
  shields_left := greatest(0, shields - misses);
  return next;
end $$;

revoke execute on function public.challenge_progress(public.challenges) from public, anon;
grant execute on function public.challenge_progress(public.challenges) to authenticated;

-- ── Recording an ending ─────────────────────────────────────────────────────────────────────────

-- The app's ending, checked against the check-ins (see the top of this file). The owner (dashboard)
-- and server jobs aren't `authenticated` and can record anything.
create function public.challenges_outcome_rule() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  p record;
  today int;
begin
  if (select auth.role()) is distinct from 'authenticated' or old.outcome is not null or new.outcome is null then
    return new;
  end if;
  today := public.challenge_day(old);
  select * into p from public.challenge_progress(old);
  if new.outcome = 'cancelled' then
    if today > 1 then raise exception 'cancel_too_late'; end if;
    new.ended_on_day := today;
  elsif new.outcome = 'finished' then
    if p.outcome <> 'finished' then raise exception 'outcome_not_reached'; end if;
    if p.under_review then raise exception 'outcome_under_review'; end if;
    new.ended_on_day := p.ended_on_day;
  elsif p.outcome = 'not_finished' then
    new.ended_on_day := p.ended_on_day;
  else
    -- Quitting, from Day 2 on: during Day 1 cancelling returns the stake instead.
    if today <= 1 then raise exception 'quit_on_day_1'; end if;
    new.ended_on_day := today;
  end if;
  new.ended_at := now();
  return new;
end $$;

drop trigger challenges_end_early_rule on public.challenges;
drop function public.challenges_end_early_rule();

create trigger challenges_outcome_rule before update of outcome, ended_on_day, ended_at on public.challenges
  for each row execute function public.challenges_outcome_rule();

-- 0019's rule (an outcome is final, except that the owner may clear it after restoring the day that
-- ended the challenge), plus buy_shield() reopening it: only alongside a shield recorded in this
-- same transaction, which nothing but buy_shield() can write.
create or replace function public.challenges_before_update() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if old.outcome is not null and (select auth.role()) is not null
     and (new.outcome, new.ended_on_day, new.ended_at) is distinct from (old.outcome, old.ended_on_day, old.ended_at)
     and not (new.outcome is null
              and exists (select 1 from public.shield_purchases s where s.challenge_id = new.id and s.created_at = now())) then
    raise exception 'outcome_is_final' using errcode = '23514';
  end if;
  return new;
end $$;

revoke execute on function public.challenges_outcome_rule() from public, anon, authenticated;

-- ── Buying a shield ─────────────────────────────────────────────────────────────────────────────

-- Buys the challenger's next revival shield and reopens the challenge. Only for a challenge its
-- misses ended (not a quit), during the day after the ending miss, up to 3. Reopening keeps the
-- start rules (0006, 0007): one running challenge per habit, and $300 staked on unended ones.
create function public.buy_shield(challenge uuid) returns public.shield_purchases
  language plpgsql security definer set search_path = ''
  as $$
declare
  c public.challenges;
  p record;
  bought int;
  purchase public.shield_purchases;
begin
  select * into c from public.challenges ch where ch.id = challenge and ch.user_id = (select auth.uid()) for update;
  if not found then raise exception 'shield_no_challenge'; end if;
  select * into p from public.challenge_progress(c);
  if c.outcome is distinct from 'not_finished' or p.outcome <> 'not_finished' or p.ended_on_day <> c.ended_on_day
     or public.challenge_day(c) <> c.ended_on_day + 1 then
    raise exception 'shield_not_available';
  end if;
  bought := (select count(*) from public.shield_purchases s where s.challenge_id = c.id);
  if bought >= 3 then raise exception 'shield_limit'; end if;

  perform pg_advisory_xact_lock(hashtext('challenges:' || c.user_id::text));
  if exists (select 1 from public.challenges o
             where o.user_id = c.user_id and o.id <> c.id and o.outcome is null
               and o.habit_id = c.habit_id and o.language is not distinct from c.language) then
    raise exception 'duplicate_challenge';
  end if;
  if (select coalesce(sum(o.stake_cents), 0) from public.challenges o where o.user_id = c.user_id and o.outcome is null)
     + c.stake_cents > 30000 then
    raise exception 'outstanding_stake_limit';
  end if;

  insert into public.shield_purchases (challenge_id, nth, day, price_cents)
    values (c.id, bought + 1, c.ended_on_day, greatest(500, ceil(c.stake_cents * (bought + 1) / 500.0)::int * 100))
    returning * into purchase;
  update public.challenges set outcome = null, ended_on_day = null, ended_at = null where id = c.id;
  return purchase;
end $$;

revoke execute on function public.buy_shield(uuid) from public, anon;
grant execute on function public.buy_shield(uuid) to authenticated;

-- ── Donations: the charity's half of each shield ────────────────────────────────────────────────

alter table public.donations drop constraint donations_source_check;
alter table public.donations add constraint donations_source_check check (source in ('stake', 'pledge', 'gift', 'shield'));

-- 0033's record, plus one 'shield' row in the challenger's name: the charity's half of every shield
-- bought, whatever the ending (donations() in challenge-rules.ts).
create or replace function public.record_donations(challenge uuid) returns void
  language sql security definer set search_path = ''
  as $$
    with c as (
      select ch.id, ch.user_id, ch.charity_id, ch.stake_cents, ch.outcome,
             h.name || coalesce(' (' || initcap(ch.language) || ')', '') as habit
      from public.challenges ch join public.habits h on h.id = ch.habit_id
      where ch.id = challenge
    ),
    due as (
      select c.user_id as giver_id, 'stake' as source, c.stake_cents as amount_cents from c where c.outcome = 'not_finished'
      union all
      select c.user_id, 'shield', sum(s.charity_cents)::int from c join public.shield_purchases s on s.challenge_id = c.id
        group by c.user_id
      union all
      select p.pledger_id, 'pledge', p.amount_cents from c join public.pledges p on p.challenge_id = c.id
        where c.outcome = 'finished' or (c.outcome = 'not_finished' and p.donate_if_not_finished)
      union all
      select g.giver_id, 'gift', g.amount_cents from c join public.extra_gifts g on g.challenge_id = c.id
        where c.outcome is not null
    ),
    gone as (
      delete from public.donations d where d.challenge_id = challenge
        and not exists (select 1 from due where due.giver_id = d.giver_id and due.source = d.source)
    )
    insert into public.donations (giver_id, challenge_id, charity_id, source, amount_cents, habit)
    select due.giver_id, c.id, c.charity_id, due.source, due.amount_cents, c.habit from due, c
    on conflict (challenge_id, giver_id, source) do update set amount_cents = excluded.amount_cents
  $$;

create trigger shield_purchases_donations after insert on public.shield_purchases
  for each row execute function public.donations_after_change();

-- ── Backers see the bought shields ──────────────────────────────────────────────────────────────

-- 0035's public list, plus each bought shield (the day it covers and its price), so a backer sees
-- which missed days were bought back. The price is 20-60% of the stake, so it hints at the stake;
-- the owner chose to show it (2026-10-01).
drop function public.discover_challenges(uuid);
create function public.discover_challenges(challenge uuid default null)
  returns table (id uuid, habit_id text, habit text, language text, level text,
                 length_days int, start_date date, time_zone text, day_offset int, charity text,
                 check_ins jsonb, shield_purchases jsonb, total_cents int, pledgers int)
  language sql stable security definer set search_path = ''
  as $$
    select c.id, c.habit_id, h.name, c.language, c.level,
           c.length_days, c.start_date, c.time_zone, c.day_offset, ch.name,
           coalesce((select jsonb_agg(jsonb_build_object('day', ci.day, 'status', ci.status) order by ci.day)
                     from public.check_ins ci where ci.challenge_id = c.id), '[]'::jsonb),
           coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'price_cents', s.price_cents) order by s.nth)
                     from public.shield_purchases s where s.challenge_id = c.id), '[]'::jsonb),
           coalesce((select sum(p.amount_cents) from public.pledges p where p.challenge_id = c.id), 0)::int,
           (select count(*) from public.pledges p where p.challenge_id = c.id)::int
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
    order by c.created_at desc
  $$;

revoke execute on function public.discover_challenges(uuid) from public, anon;
grant execute on function public.discover_challenges(uuid) to authenticated;
