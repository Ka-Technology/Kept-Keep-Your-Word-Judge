-- Proves the challenges module's privileges, RLS policies, stake limits, check-in rules, cancelling
-- or quitting (0026, T52) and the cascade from delete_account() (migrations 0004-0007, SPEC-challenges.md).
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/challenges_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'challenges-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b1', 'challenges-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000c1', 'challenges-c@kept.test');

insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a1', 'ch_test_a', '1990-01-01', 'NY'),
  ('00000000-0000-4000-8000-0000000000b1', 'ch_test_b', '1990-01-01', 'CA');
-- C has no profile. A and B answered the AI question, which a check-in now waits for (0038).
update public.profiles set ai_allowed = true where id in ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1');

-- B's challenge, created as the owner would (no user JWT), for the cross-user checks below.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000b1', 'workout', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now());
select set_config('test.b_challenge', (select id::text from public.challenges where user_id = '00000000-0000-4000-8000-0000000000b1'), true);

-- Privileges and the seeded lists
do $$
begin
  if has_table_privilege('anon', 'public.challenges', 'select') or has_table_privilege('anon', 'public.check_ins', 'select')
     or has_table_privilege('anon', 'public.charities', 'select') or has_table_privilege('anon', 'public.habits', 'select') then
    raise exception 'FAIL: anon can read challenge data';
  end if;
  if has_any_column_privilege('anon', 'public.challenges', 'insert') or has_any_column_privilege('anon', 'public.check_ins', 'insert') then
    raise exception 'FAIL: anon can create challenges or check-ins';
  end if;
  if has_table_privilege('authenticated', 'public.challenges', 'delete') or has_table_privilege('authenticated', 'public.check_ins', 'delete') then
    raise exception 'FAIL: authenticated can delete challenges or check-ins';
  end if;
  -- A check-in's photo and status can change, under verification's trigger (0013, T25); nothing else.
  if has_column_privilege('authenticated', 'public.check_ins', 'day', 'update')
     or has_column_privilege('authenticated', 'public.check_ins', 'challenge_id', 'update')
     or has_column_privilege('authenticated', 'public.check_ins', 'created_at', 'update') then
    raise exception 'FAIL: authenticated can change a check-in';
  end if;
  if has_column_privilege('authenticated', 'public.challenges', 'stake_cents', 'update')
     or has_column_privilege('authenticated', 'public.challenges', 'start_date', 'insert')
     or has_column_privilege('authenticated', 'public.challenges', 'user_id', 'insert')
     or has_column_privilege('authenticated', 'public.challenges', 'outcome', 'insert')
     or has_column_privilege('authenticated', 'public.challenges', 'day_offset', 'update')
     or has_column_privilege('authenticated', 'public.check_ins', 'status', 'insert') then
    raise exception 'FAIL: authenticated can set a column it must not';
  end if;
  -- The 11 seeded charities (0004) all stay; 10 are Kept's curated picks (0054). Searched ones add rows after them.
  if (select count(*) from public.charities
      where id = any (array['msf', 'st-jude', 'charity-water', 'feeding-america', 'nature-conservancy', 'aspca', 'oceana', 'rare', 'catf', 'giving-green', 'founders-pledge-climate'])) <> 11 then
    raise exception 'FAIL: expected the 11 seeded charities';
  end if;
  if (select count(*) from public.charities where featured) <> 10
     or exists (select 1 from public.charities where id = 'founders-pledge-climate' and featured) then
    raise exception 'FAIL: expected 10 featured charities, without founders-pledge-climate';
  end if;
  -- App users only read the catalog; the owner key writes it (the charities Edge Function).
  if has_table_privilege('authenticated', 'public.charities', 'insert')
     or has_table_privilege('authenticated', 'public.charities', 'update')
     or has_table_privilege('authenticated', 'public.charities', 'delete')
     or has_table_privilege('anon', 'public.charities', 'select') then
    raise exception 'FAIL: the charity catalog is writable by app users, or readable by anon';
  end if;
  -- A searched charity: an EIN is 9 digits and belongs to one row; a logo is an https address.
  begin
    insert into public.charities (id, name, purpose, position, ein) values ('ein-bad', 'Bad', 'x', 1000, '12345678');
    raise exception 'FAIL: an EIN of 8 digits was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.charities (id, name, purpose, position, logo_url) values ('ein-logo', 'Logo', 'x', 1000, 'javascript:alert(1)');
    raise exception 'FAIL: a logo that is not https was accepted';
  exception when check_violation then null;
  end;
  insert into public.charities (id, name, purpose, position, ein, slug) values ('ein-111111111', 'Searched One', 'x', 1000, '111111111', 'searched-one');
  begin
    insert into public.charities (id, name, purpose, position, ein) values ('ein-dup', 'Searched Twice', 'x', 1000, '111111111');
    raise exception 'FAIL: two charities with the same EIN were accepted';
  exception when unique_violation then null;
  end;
  -- Kept's 16 habits (0004, 0043, 0044); a habit 0044 took off stays only while a challenge uses it.
  if exists (select 1 from unnest(array['read', 'language', 'study', 'leetcode', 'chess', 'workout', 'walk-run', 'steps', 'bike', 'stretch', 'cook', 'greens', 'journal', 'meditate', 'instrument', 'draw']) as e(id)
             where not exists (select 1 from public.habits h where h.id = e.id))
     or exists (select 1 from public.habits h
                where h.id <> all (array['read', 'language', 'study', 'leetcode', 'chess', 'workout', 'walk-run', 'steps', 'bike', 'stretch', 'cook', 'greens', 'journal', 'meditate', 'instrument', 'draw'])
                  and not exists (select 1 from public.challenges c where c.habit_id = h.id)) then
    raise exception 'FAIL: the habit list isn''t Kept''s 16';
  end if;
end $$;

-- As user A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

-- Stake limits
do $$
declare
  first_id uuid;
  msg text;
begin
  -- A reads every charity row (the 11 seeded, plus any searched ones) and the habit list, and changes none.
  if (select count(*) from public.charities) < 11 or (select count(*) from public.habits) < 16 then
    raise exception 'FAIL: A cannot read the charity and habit lists';
  end if;
  begin
    insert into public.charities (id, name, purpose, position) values ('made-up', 'Made Up', 'x', 1000);
    raise exception 'FAIL: A added a charity';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.charities set name = 'Renamed' where id = 'msf';
    raise exception 'FAIL: A renamed a charity';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.challenges) then raise exception 'FAIL: A sees another user''s challenge'; end if;

  -- The first challenge is capped at $25.
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
      values ('read', 28, 2600, 'msf', 'card', 'America/Los_Angeles', now());
    raise exception 'FAIL: a first challenge over $25 was accepted';
  exception when check_violation then
    get stacked diagnostics msg = message_text;
    if msg <> 'first_challenge_stake_limit' then raise exception 'FAIL: wrong first-challenge error: %', msg; end if;
  end;

  insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values ('read', 28, 2500, 'msf', 'card', 'America/Los_Angeles', now())
    returning id into first_id;
  if (select user_id from public.challenges where id = first_id) <> '00000000-0000-4000-8000-0000000000a1' then
    raise exception 'FAIL: the new challenge isn''t owned by its creator';
  end if;
  if (select start_date from public.challenges where id = first_id) <> (now() at time zone 'America/Los_Angeles')::date + 1 then
    raise exception 'FAIL: Day 1 isn''t the day after creation in the challenge''s time zone';
  end if;
  if (select public.challenge_day(c) from public.challenges c where id = first_id) <> 0 then
    raise exception 'FAIL: challenge_day isn''t 0 before Day 1';
  end if;

  -- The amount itself: at least $10, in whole dollars (migration 0006).
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
      values ('read', 28, 900, 'msf', 'card', 'America/Los_Angeles', now());
    raise exception 'FAIL: a stake under $10 was accepted';
  exception when check_violation then
    get stacked diagnostics msg = message_text;
    if msg <> 'stake_minimum' then raise exception 'FAIL: wrong minimum-stake error: %', msg; end if;
  end;
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
      values ('meditate', 28, 1050, 'msf', 'card', 'America/Los_Angeles', now());
    raise exception 'FAIL: a stake that isn''t whole dollars was accepted';
  exception when check_violation then null;
  end;

  -- No maximum per challenge, but $300 in total on unended challenges: $25 + $150 + $125 fits,
  -- $10 more doesn't.
  insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values ('workout', 42, 15000, 'oceana', 'solana_usdc', 'America/Los_Angeles', now()),
           ('journal', 56, 12500, 'rare', 'card', 'America/Los_Angeles', now());
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
      values ('cook', 28, 1000, 'msf', 'card', 'America/Los_Angeles', now());
    raise exception 'FAIL: stakes over $300 in total were accepted';
  exception when check_violation then
    get stacked diagnostics msg = message_text;
    if msg <> 'outstanding_stake_limit' then raise exception 'FAIL: wrong total-limit error: %', msg; end if;
  end;

  -- An ended challenge no longer counts towards the $300, so $25 fits again. (Cancelled before Day 1:
  -- a finish needs its days, 0039.)
  update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now() where id = first_id;
  insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values ('cook', 28, 2500, 'msf', 'card', 'America/Los_Angeles', now());
end $$;

-- What a challenge can be, what can change, and check-ins
do $$
declare
  ch uuid;
  n int;
begin
  -- Ending another challenge frees room for the checks below. It's moved to Day 3 first: a
  -- signed-in user can't end one as not finished during Day 1 (0026: that's a cancel).
  reset role;
  perform set_config('request.jwt.claims', '', true); -- the owner moves the clock
  update public.challenges set day_offset = 3 where user_id = '00000000-0000-4000-8000-0000000000a1' and habit_id = 'workout' and outcome is null;
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  update public.challenges set outcome = 'not_finished', ended_on_day = 3, ended_at = now()
    where habit_id = 'workout' and outcome is null;

  -- Learn a language needs a language and level; other habits can't have them.
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
      values ('language', 28, 1000, 'msf', 'card', 'America/Los_Angeles', now());
    raise exception 'FAIL: Learn a language was accepted without a language and level';
  exception when check_violation then null;
  end;
  -- (45 days: any length from 28 to 365 is fine.)
  insert into public.challenges (habit_id, language, level, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values ('language', 'japanese', 'beginner', 45, 1000, 'msf', 'card', 'Asia/Tokyo', now())
    returning id into ch;
  begin
    insert into public.challenges (habit_id, language, level, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
      values ('workout', 'french', 'advanced', 28, 1000, 'msf', 'card', 'America/Los_Angeles', now());
    raise exception 'FAIL: a language was accepted on a habit other than Learn a language';
  exception when check_violation then null;
  end;

  -- Only listed charities and habits, known time zones, 28-365 days and the two ways to pay.
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
      values ('read', 28, 1000, 'not-a-charity', 'card', 'America/Los_Angeles', now());
    raise exception 'FAIL: a charity outside the list was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
      values ('quit-vaping', 28, 1000, 'msf', 'card', 'America/Los_Angeles', now());
    raise exception 'FAIL: a habit outside the list was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
      values ('read', 28, 1000, 'msf', 'card', 'Mars/Olympus_Mons', now());
    raise exception 'FAIL: an unknown time zone was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
      values ('read', 27, 1000, 'msf', 'card', 'America/Los_Angeles', now());
    raise exception 'FAIL: a length under 28 days was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
      values ('read', 366, 1000, 'msf', 'card', 'America/Los_Angeles', now());
    raise exception 'FAIL: a length over 365 days was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
      values ('read', 28, 1000, 'msf', 'paypal', 'America/Los_Angeles', now());
    raise exception 'FAIL: an unknown way to pay was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone)
      values ('read', 28, 1000, 'msf', 'card', 'America/Los_Angeles');
    raise exception 'FAIL: a challenge without consent was accepted';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, start_date)
      values ('read', 28, 1000, 'msf', 'card', 'America/Los_Angeles', now(), current_date);
    raise exception 'FAIL: the app could choose its own start date';
  exception when insufficient_privilege then null;
  end;

  -- A changes only their own challenges, and only the allowed columns.
  update public.challenges set outcome = 'not_finished', ended_on_day = 1, ended_at = now() where id = current_setting('test.b_challenge')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: A changed B''s challenge'; end if;
  begin
    update public.challenges set stake_cents = 100 where id = ch;
    raise exception 'FAIL: A changed a stake after starting';
  exception when insufficient_privilege then null;
  end;

  -- Check-ins: only today's, once, on a running challenge of your own. The demo clock moves today,
  -- through the server since T27 (the ai-check function, as the service role).
  reset role;
  perform public.demo_next_day(ch, '00000000-0000-4000-8000-0000000000a1');
  set local role authenticated;
  if (select public.challenge_day(c) from public.challenges c where id = ch) <> 1 then
    raise exception 'FAIL: one "Next day" didn''t make it Day 1';
  end if;
  insert into public.check_ins (challenge_id, day) values (ch, 1);
  if (select status from public.check_ins where challenge_id = ch and day = 1) <> 'pending' then
    raise exception 'FAIL: a new check-in isn''t pending (verification, 0013)';
  end if;
  begin
    insert into public.check_ins (challenge_id, day) values (ch, 1);
    raise exception 'FAIL: a second check-in for the same day was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.check_ins (challenge_id, day) values (ch, 2);
    raise exception 'FAIL: a check-in for a day other than today was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.check_ins (challenge_id, day, status) values (ch, 1, 'excused');
    raise exception 'FAIL: the app could choose a check-in''s status';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.check_ins (challenge_id, day) values (current_setting('test.b_challenge')::uuid, 1);
    raise exception 'FAIL: A checked in on B''s challenge';
  exception when check_violation or insufficient_privilege then null;
  end;

  -- The outcome is final once recorded, and an ended challenge takes no more check-ins.
  reset role;
  perform set_config('request.jwt.claims', '', true); -- the owner moves the clock
  update public.challenges set day_offset = 3 where id = ch;
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  update public.challenges set outcome = 'not_finished', ended_on_day = 3, ended_at = now() where id = ch;
  begin
    update public.challenges set outcome = 'finished' where id = ch;
    raise exception 'FAIL: a recorded outcome was changed';
  exception when check_violation then null;
  end;
  reset role;
  perform public.demo_next_day(ch, '00000000-0000-4000-8000-0000000000a1');
  set local role authenticated;
  begin
    insert into public.check_ins (challenge_id, day) values (ch, 2);
    raise exception 'FAIL: a check-in on an ended challenge was accepted';
  exception when check_violation then null;
  end;
end $$;

-- One running challenge per habit, and per language for Learn a language (migration 0007).
do $$
declare
  msg text;
begin
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
      values ('journal', 30, 1000, 'msf', 'card', 'America/Los_Angeles', now());
    raise exception 'FAIL: a second running Journal challenge was accepted';
  exception when check_violation then
    get stacked diagnostics msg = message_text;
    if msg <> 'duplicate_challenge' then raise exception 'FAIL: wrong duplicate error: %', msg; end if;
  end;

  insert into public.challenges (habit_id, language, level, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values ('language', 'korean', 'beginner', 28, 1000, 'msf', 'card', 'America/Los_Angeles', now());
  begin
    insert into public.challenges (habit_id, language, level, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
      values ('language', 'korean', 'advanced', 30, 1000, 'msf', 'card', 'America/Los_Angeles', now());
    raise exception 'FAIL: a second running Korean challenge was accepted';
  exception when check_violation then
    get stacked diagnostics msg = message_text;
    if msg <> 'duplicate_challenge' then raise exception 'FAIL: wrong duplicate error: %', msg; end if;
  end;

  -- Another language is fine, and so is a habit whose last challenge has ended.
  insert into public.challenges (habit_id, language, level, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values ('language', 'japanese', 'intermediate', 28, 1000, 'msf', 'card', 'America/Los_Angeles', now());
  update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now()
    where habit_id = 'journal' and outcome is null;
  insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values ('journal', 28, 1000, 'msf', 'card', 'America/Los_Angeles', now());
end $$;

-- As B: nothing of A's is visible.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);

do $$
begin
  if (select count(*) from public.challenges) <> 1 then raise exception 'FAIL: B sees challenges other than their own'; end if;
  if exists (select 1 from public.check_ins) then raise exception 'FAIL: B sees A''s check-ins'; end if;
end $$;

-- As C, who has no profile: no challenges.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

do $$
begin
  insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values ('read', 28, 1000, 'msf', 'card', 'America/Los_Angeles', now());
  raise exception 'FAIL: a user without a profile started a challenge';
exception when insufficient_privilege then null;
end $$;

-- A deletes their account: their challenges and check-ins go with it, B's stay. A's challenge ids
-- are noted first, so the check below looks only at A's check-ins, not real users'.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
-- Cancel or quit (0026, T52): B's challenges at Day 0, Day 1 and Day 2, as the owner would move the clock.
reset role;
select set_config('request.jwt.claims', '', true); -- the dashboard has no user
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, day_offset)
select '00000000-0000-4000-8000-0000000000b1', h, 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now(), o
from (values ('stretch', 0), ('read', 1), ('meditate', 1), ('journal', 2)) as v(h, o);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);

do $$
declare
  me uuid := '00000000-0000-4000-8000-0000000000b1';
  n int;
begin
  -- Cancel until the end of Day 1, before it starts included.
  update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now() where user_id = me and habit_id = 'stretch';
  update public.challenges set outcome = 'cancelled', ended_on_day = 1, ended_at = now() where user_id = me and habit_id = 'read';
  select count(*) into n from public.challenges where user_id = me and outcome = 'cancelled';
  if n <> 2 then raise exception 'FAIL: % challenges cancelled, expected 2', n; end if;
  -- Not on Day 2: quit instead.
  begin
    update public.challenges set outcome = 'cancelled', ended_on_day = 2, ended_at = now() where user_id = me and habit_id = 'journal';
    raise exception 'FAIL: a challenge was cancelled on Day 2';
  exception when raise_exception then
    if sqlerrm <> 'cancel_too_late' then raise; end if;
  end;
  update public.challenges set outcome = 'not_finished', ended_on_day = 2, ended_at = now() where user_id = me and habit_id = 'journal';
  -- Quitting during Day 1 is refused: cancelling returns the stake then.
  begin
    update public.challenges set outcome = 'not_finished', ended_on_day = 1, ended_at = now() where user_id = me and habit_id = 'meditate';
    raise exception 'FAIL: a challenge was quit on Day 1';
  exception when raise_exception then
    if sqlerrm <> 'quit_on_day_1' then raise; end if;
  end;
  -- A cancel is final, and frees the habit for a new challenge.
  begin
    update public.challenges set outcome = 'finished' where user_id = me and habit_id = 'read';
    raise exception 'FAIL: a cancelled challenge was changed';
  exception when check_violation then null;
  end;
  insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values ('read', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now());
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

select set_config('test.a_challenges', (select string_agg(id::text, ',') from public.challenges), true);
do $$
begin
  if not exists (select 1 from public.check_ins) then raise exception 'FAIL: A has no check-ins to test the cascade with'; end if;
end $$;
-- delete_account() refuses while a challenge hasn't ended (0052, decision 103; proven in delete_account_rls.sql),
-- so end A's last one first: this test is about the cascade.
reset role;
update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now()
  where user_id = '00000000-0000-4000-8000-0000000000a1' and outcome is null;
set local role authenticated;
select public.delete_account();

reset role;
select set_config('request.jwt.claims', '', true); -- the dashboard has no user

do $$
begin
  if exists (select 1 from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL: delete_account() left challenges behind';
  end if;
  if exists (select 1 from public.check_ins where challenge_id::text = any (string_to_array(current_setting('test.a_challenges'), ','))) then
    raise exception 'FAIL: check-ins outlived their challenge';
  end if;
  if not exists (select 1 from public.challenges where user_id = '00000000-0000-4000-8000-0000000000b1') then
    raise exception 'FAIL: delete_account() removed another user''s challenge';
  end if;
end $$;

rollback;

select 'PASS: challenges privileges, RLS, stake limits, check-in rules, cancel or quit and delete_account()' as result;
