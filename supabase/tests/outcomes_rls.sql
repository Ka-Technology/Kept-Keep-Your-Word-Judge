-- Proves the security review's fixes (migrations 0038 and 0039, 2026-10-01): a check-in needs its
-- photo (Read also its book and pages) and the AI answer first; an ending is checked against the
-- check-ins, so a finish can't be forged or recorded while its last day is being checked, and the
-- server sets the day and time it ended; two shields, so two misses still run; and revival shields:
-- bought only the day after the miss that ended it, priced off the stake, half recorded as a
-- donation, read by friends with the challenge and by backers through Discover, never written
-- directly.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/outcomes_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A is the challenger; B is A's friend, who never answered the AI question; C is a stranger.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a9', 'outcomes-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b9', 'outcomes-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000c9', 'outcomes-c@kept.test');

insert into public.profiles (id, username, date_of_birth, state_code, ai_allowed) values
  ('00000000-0000-4000-8000-0000000000a9', 'out_test_a', '1990-01-01', 'NY', true),
  ('00000000-0000-4000-8000-0000000000b9', 'out_test_b', '1990-01-01', 'CA', null),
  ('00000000-0000-4000-8000-0000000000c9', 'out_test_c', '1990-01-01', 'TX', true);

insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000b9', 'accepted', now() - interval '10 days');

-- As the owner would make them: A's public Work out ($25, the first), Read and Stretch; B's Cook.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, day_offset)
  values ('00000000-0000-4000-8000-0000000000a9', 'workout', 28, 2500, 'aspca', 'card', 'America/Los_Angeles', now(), 2);
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, day_offset)
  values ('00000000-0000-4000-8000-0000000000a9', 'read', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now(), 1),
         ('00000000-0000-4000-8000-0000000000a9', 'stretch', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now(), 29),
         ('00000000-0000-4000-8000-0000000000b9', 'cook', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now(), 1);
update public.challenges set is_public = true where habit_id = 'workout' and user_id = '00000000-0000-4000-8000-0000000000a9';
select set_config('test.workout', (select id::text from public.challenges where habit_id = 'workout' and user_id = '00000000-0000-4000-8000-0000000000a9'), true);
select set_config('test.read', (select id::text from public.challenges where habit_id = 'read' and user_id = '00000000-0000-4000-8000-0000000000a9'), true);
select set_config('test.stretch', (select id::text from public.challenges where habit_id = 'stretch' and user_id = '00000000-0000-4000-8000-0000000000a9'), true);
select set_config('test.cook', (select id::text from public.challenges where habit_id = 'cook' and user_id = '00000000-0000-4000-8000-0000000000b9'), true);

-- Stretch: 27 days approved and day 28 still waiting for a friend, now that it's Day 29.
insert into public.check_ins (challenge_id, day, status)
  select current_setting('test.stretch')::uuid, d, case when d = 28 then 'pending' else 'approved' end from generate_series(1, 28) d;

-- As A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);

do $$
declare
  msg text;
begin
  -- 0038: every habit but Learn a language checks in with a photo, and Read with the book and pages.
  begin
    insert into public.check_ins (challenge_id, day) values (current_setting('test.workout')::uuid, 2);
    raise exception 'FAIL: a Work out check-in without a photo was accepted';
  exception when check_violation then get stacked diagnostics msg = message_text;
    if msg <> 'check_in_photo_required' then raise exception 'FAIL: wrong no-photo error: %', msg; end if;
  end;
  begin
    insert into public.check_ins (challenge_id, day, photo_path)
      values (current_setting('test.read')::uuid, 1, '00000000-0000-4000-8000-0000000000a9/' || current_setting('test.read') || '/1-1.jpg');
    raise exception 'FAIL: a Read check-in without the book and pages was accepted';
  exception when check_violation then get stacked diagnostics msg = message_text;
    if msg <> 'check_in_read_details' then raise exception 'FAIL: wrong Read error: %', msg; end if;
  end;

  -- 0039: a finish the check-ins don't support.
  begin
    update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() where id = current_setting('test.workout')::uuid;
    raise exception 'FAIL: a finish on Day 2 was recorded';
  exception when raise_exception then
    if sqlerrm <> 'outcome_not_reached' then raise; end if;
  end;
  -- A finish waits while a day it counts is still being checked.
  begin
    update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() where id = current_setting('test.stretch')::uuid;
    raise exception 'FAIL: a finish was recorded while its last day was still being checked';
  exception when raise_exception then
    if sqlerrm <> 'outcome_under_review' then raise; end if;
  end;
end $$;

-- A friend approves day 28 (as the owner here, for brevity); now the finish records, on day 28.
reset role;
select set_config('request.jwt.claims', '', true);
update public.check_ins set status = 'approved' where challenge_id = current_setting('test.stretch')::uuid and day = 28;
update public.challenges set day_offset = 3 where id = current_setting('test.workout')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);

do $$
declare
  c public.challenges;
  p record;
begin
  update public.challenges set outcome = 'finished', ended_on_day = 99, ended_at = now() - interval '1 year' where id = current_setting('test.stretch')::uuid;
  select * into c from public.challenges where id = current_setting('test.stretch')::uuid;
  if c.outcome <> 'finished' or c.ended_on_day <> 28 or c.ended_at <> now() then
    raise exception 'FAIL: the server didn''t set the finish''s day and time (got %, %)', c.ended_on_day, c.ended_at;
  end if;

  -- Two shields: Work out on Day 3 with days 1 and 2 missed is still running, with none left.
  select * into c from public.challenges where id = current_setting('test.workout')::uuid;
  select * into p from public.challenge_progress(c);
  if p.outcome <> 'active' or p.misses <> 2 or p.shields_left <> 0 then
    raise exception 'FAIL: two misses ended the challenge or left shields (%, %, %)', p.outcome, p.misses, p.shields_left;
  end if;
end $$;

-- Day 4: the third miss (day 3) ended Work out. A records it, then buys a shield the next day.
reset role;
select set_config('request.jwt.claims', '', true);
update public.challenges set day_offset = 4 where id = current_setting('test.workout')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);

do $$
declare
  ch uuid := current_setting('test.workout')::uuid;
  c public.challenges;
  bought public.shield_purchases;
begin
  update public.challenges set outcome = 'not_finished', ended_on_day = 1, ended_at = now() - interval '1 year' where id = ch;
  select * into c from public.challenges where id = ch;
  if c.ended_on_day <> 3 or c.ended_at <> now() then raise exception 'FAIL: the ending''s day isn''t the third miss (got %)', c.ended_on_day; end if;

  -- 20% of $25 is $5 (and $5 is the least).
  select * into bought from public.buy_shield(ch);
  if bought.nth <> 1 or bought.day <> 3 or bought.price_cents <> 500 or bought.charity_cents <> 250 or bought.kept_cents <> 250 then
    raise exception 'FAIL: the first shield isn''t $5 for day 3, half and half';
  end if;
  if (select outcome from public.challenges where id = ch) is not null then raise exception 'FAIL: the shield didn''t reopen the challenge'; end if;
  if not exists (select 1 from public.donations where challenge_id = ch and source = 'shield' and amount_cents = 250)
     or exists (select 1 from public.donations where challenge_id = ch and source = 'stake') then
    raise exception 'FAIL: the donations aren''t the shield''s half without the stake';
  end if;

  -- Running again: no second purchase until another miss ends it.
  begin
    perform public.buy_shield(ch);
    raise exception 'FAIL: a shield was bought for a running challenge';
  exception when raise_exception then
    if sqlerrm <> 'shield_not_available' then raise; end if;
  end;
  -- Nobody writes a purchase directly, or reopens an ended challenge without one.
  begin
    insert into public.shield_purchases (challenge_id, nth, day, price_cents) values (ch, 2, 4, 500);
    raise exception 'FAIL: A wrote a shield purchase directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.challenges set outcome = null, ended_on_day = null, ended_at = null where id = current_setting('test.stretch')::uuid;
    raise exception 'FAIL: A reopened a finished challenge';
  exception when check_violation then null;
  end;
end $$;

-- As B, A's friend: reads the purchase with the challenge. B's own check-in waits for the AI answer.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b9","role":"authenticated"}', true);
do $$
declare
  msg text;
begin
  if (select count(*) from public.shield_purchases where challenge_id = current_setting('test.workout')::uuid) <> 1 then
    raise exception 'FAIL: A''s friend can''t see the shield A bought';
  end if;
  begin
    insert into public.check_ins (challenge_id, day, photo_path)
      values (current_setting('test.cook')::uuid, 1, '00000000-0000-4000-8000-0000000000b9/' || current_setting('test.cook') || '/1-1.jpg');
    raise exception 'FAIL: a check-in was accepted before the AI question was answered';
  exception when check_violation then get stacked diagnostics msg = message_text;
    if msg <> 'ai_choice_needed' then raise exception 'FAIL: wrong AI-choice error: %', msg; end if;
  end;
end $$;

-- As C, a stranger: the purchase only through Discover, with its day and price.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c9","role":"authenticated"}', true);
do $$
declare
  shields jsonb := (select d.shield_purchases from public.discover_challenges(current_setting('test.workout')::uuid) d);
begin
  if exists (select 1 from public.shield_purchases) then raise exception 'FAIL: a stranger reads shield purchases directly'; end if;
  if shields is null or jsonb_array_length(shields) <> 1 or (shields -> 0 ->> 'day')::int <> 3 or (shields -> 0 ->> 'price_cents')::int <> 500 then
    raise exception 'FAIL: Discover doesn''t show the bought shield''s day and price: %', shields;
  end if;
end $$;

-- Day 6: days 4 and 5 missed, the fourth miss (day 4) ended it again, and the next day has passed.
reset role;
select set_config('request.jwt.claims', '', true);
update public.challenges set day_offset = 6 where id = current_setting('test.workout')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
do $$
declare
  ch uuid := current_setting('test.workout')::uuid;
begin
  update public.challenges set outcome = 'not_finished', ended_on_day = 6, ended_at = now() where id = ch;
  if (select ended_on_day from public.challenges where id = ch) <> 4 then raise exception 'FAIL: the bought shield didn''t carry it past day 3'; end if;
  begin
    perform public.buy_shield(ch);
    raise exception 'FAIL: a shield was bought after its day had passed';
  exception when raise_exception then
    if sqlerrm <> 'shield_not_available' then raise; end if;
  end;
end $$;

rollback;

select 'PASS: check-ins need their photo, Read details and the AI answer; endings checked by the server; 2 shields; revival shields bought only in their window, half donated, seen by friends and backers' as result;
