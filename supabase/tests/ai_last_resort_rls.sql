-- Proves Kept's AI as a last resort (migration 0085, T243, plan.md decision 180): the step-in time is the user's
-- own setting and only a valid one (9:00 pm to midnight, any minute); the ceiling counts 3 AI calls for
-- each stake challenge that hasn't ended, at least 4, over a rolling 24 hours; a call Kept failed to make is
-- released; the first day over the limit in a challenge passes and later ones don't; ai_check_claim() takes a
-- waiting photo check from the user's time and returns who it belongs to; and the quiz bank, the usage log and the
-- passes are the server's alone (no answer key ever reaches an app user).
-- Everything runs in one transaction that is rolled back, so no test data persists. The claim's time-of-day
-- checks use a fixed-offset zone where it is 10 pm right now, so they hold at any hour (a run that crosses
-- an hour boundary can fail once; run it again).
-- Run: npx supabase db query --remote=<the test project's ref> -f supabase/tests/ai_last_resort_rls.sql
-- Before 0085 is pushed, run it together with the migration in ONE transaction that rolls back: a file that is
-- `begin;`, then the migration's SQL, then this file (whose own `begin` only warns). Never put the migration
-- ahead of a `begin`: it would commit.
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a5', 'ailast-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b5', 'ailast-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000c5', 'ailast-c@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a5', 'ailast_a', '1990-01-01', 'NY'),
  ('00000000-0000-4000-8000-0000000000b5', 'ailast_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000c5', 'ailast_c', '1990-01-01', 'TX');
update public.profiles set ai_allowed = true where id = '00000000-0000-4000-8000-0000000000c5';
-- The allowance's floor is a setting (migration 0088) the test project raises for the judges; these checks are about the default, 4.
update public.ai_settings set calls_floor = 4;

-- Privileges: the server's alone
do $$
declare
  t text;
  f text;
begin
  foreach t in array array['ai_usage', 'ai_limit_passes', 'quiz_bank'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'insert')
       or has_table_privilege('authenticated', 'public.' || t, 'update') or has_table_privilege('authenticated', 'public.' || t, 'delete')
       or has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('anon', 'public.' || t, 'insert') then
      raise exception 'FAIL: an app user can reach %', t;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'FAIL: RLS is off on %', t;
    end if;
  end loop;
  foreach f in array array['public.ai_allowance(uuid)', 'public.ai_take(uuid, text)', 'public.ai_release(bigint)',
                           'public.ai_limit_day(uuid, int)', 'public.ai_check_claim(uuid)', 'public.quiz_claim_write(uuid)'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'FAIL: an app user can run %', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception 'FAIL: the service role can''t run %', f;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.profiles', 'ai_from_minutes', 'update') then
    raise exception 'FAIL: a user can''t change their own step-in time';
  end if;
  if (select ai_from_minutes from public.profiles where id = '00000000-0000-4000-8000-0000000000a5') <> 1320 then
    raise exception 'FAIL: the step-in time isn''t 10 pm by default';
  end if;
end $$;

-- The step-in time: the user's own, and only a valid one
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);

do $$
declare
  n int;
  v int;
begin
  update public.profiles set ai_from_minutes = 1380 where id = '00000000-0000-4000-8000-0000000000a5';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A couldn''t set their step-in time to 11 pm'; end if;
  update public.profiles set ai_from_minutes = 1440 where id = '00000000-0000-4000-8000-0000000000a5';
  update public.profiles set ai_from_minutes = 1335 where id = '00000000-0000-4000-8000-0000000000a5';
  -- Any minute from 9:00 pm (migration 0086), not only the quarter hours.
  foreach v in array array[1260, 1300, 1325, 1327] loop
    update public.profiles set ai_from_minutes = v where id = '00000000-0000-4000-8000-0000000000a5';
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'FAIL: A couldn''t set their step-in time to % minutes', v; end if;
  end loop;
  foreach v in array array[1259, 1200, 1441, 1455, 0] loop
    begin
      update public.profiles set ai_from_minutes = v where id = '00000000-0000-4000-8000-0000000000a5';
      raise exception 'FAIL: A set the step-in time to %', v;
    exception when check_violation then null;
    end;
  end loop;
  -- Never someone else's.
  update public.profiles set ai_from_minutes = 1380 where id = '00000000-0000-4000-8000-0000000000b5';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: A changed B''s step-in time'; end if;
  -- Nor the log, the bank or the passes.
  begin
    perform 1 from public.quiz_bank;
    raise exception 'FAIL: A read the quiz bank';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.ai_usage;
    raise exception 'FAIL: A read the AI usage log';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

-- The allowance: 3 for each stake challenge that hasn't ended, at least 4
do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a5';
begin
  if public.ai_allowance(a) <> 4 then raise exception 'FAIL: with no challenge the allowance isn''t 4'; end if;
  insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values (a, 'workout', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now());
  if public.ai_allowance(a) <> 4 then raise exception 'FAIL: with one challenge the allowance isn''t 4'; end if;
  insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values (a, 'cook', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now());
  if public.ai_allowance(a) <> 6 then raise exception 'FAIL: with two challenges the allowance isn''t 6'; end if;
  insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values (a, 'journal', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now());
  if public.ai_allowance(a) <> 9 then raise exception 'FAIL: with three challenges the allowance isn''t 9'; end if;
  -- One that has ended no longer counts (triggers off just to record the ending).
  set local session_replication_role = replica;
  update public.challenges set outcome = 'not_finished', ended_on_day = 3, ended_at = now()
    where id = (select id from public.challenges where user_id = a and habit_id = 'journal');
  set local session_replication_role = origin;
  if public.ai_allowance(a) <> 6 then raise exception 'FAIL: an ended challenge still counts'; end if;
  -- Someone else's challenges aren't mine.
  if public.ai_allowance('00000000-0000-4000-8000-0000000000b5') <> 4 then raise exception 'FAIL: B''s allowance counts A''s challenges'; end if;
end $$;

-- The ceiling: calls over a rolling 24 hours
do $$
declare
  b uuid := '00000000-0000-4000-8000-0000000000b5';
  c uuid := '00000000-0000-4000-8000-0000000000c5';
  call bigint;
  oldest bigint;
  n int;
begin
  -- B has no challenge, so 4 calls.
  for i in 1..4 loop
    if public.ai_take(b, 'photo') is null then raise exception 'FAIL: call % was refused within the allowance', i; end if;
  end loop;
  if public.ai_take(b, 'photo') is not null then raise exception 'FAIL: the fifth call went through'; end if;
  select count(*) into n from public.ai_usage where user_id = b;
  if n <> 4 then raise exception 'FAIL: a refused call was recorded (% rows)', n; end if;

  -- One user's calls don't use up another's.
  if public.ai_take(c, 'quiz_write') is null then raise exception 'FAIL: C was refused because of B'; end if;

  -- A call more than 24 hours old doesn't count.
  select min(id) into oldest from public.ai_usage where user_id = b;
  update public.ai_usage set at = now() - interval '25 hours' where id = oldest;
  call := public.ai_take(b, 'quiz_grade');
  if call is null then raise exception 'FAIL: a 25-hour-old call still counted'; end if;
  if public.ai_take(b, 'photo') is not null then raise exception 'FAIL: the window let a fifth in'; end if;

  -- A released call (Kept's failure) frees its place.
  perform public.ai_release(call);
  if public.ai_take(b, 'bank') is null then raise exception 'FAIL: a released call still counted'; end if;
  perform public.ai_release(-1);

  -- A week of history is kept, no more (pruned when a call goes through).
  update public.ai_usage set at = now() - interval '8 days' where id = oldest;
  select count(*) into n from public.ai_usage where user_id = b and at < now() - interval '7 days';
  if n <> 1 then raise exception 'FAIL: the old row isn''t there to prune'; end if;
  select min(id) into oldest from public.ai_usage where user_id = b and at > now() - interval '1 hour';
  perform public.ai_release(oldest);
  perform public.ai_take(b, 'photo');
  select count(*) into n from public.ai_usage where user_id = b and at < now() - interval '7 days';
  if n <> 0 then raise exception 'FAIL: a row older than a week stayed'; end if;

  -- Only the four kinds.
  begin
    perform public.ai_take(c, 'nonsense');
    raise exception 'FAIL: an unknown kind was recorded';
  exception when check_violation then null;
  end;
end $$;

-- The first day over the limit passes; later ones don't, per challenge
do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a5';
  one uuid := (select id from public.challenges where user_id = a and habit_id = 'workout');
  two uuid := (select id from public.challenges where user_id = a and habit_id = 'cook');
begin
  if not public.ai_limit_day(one, 3) then raise exception 'FAIL: the first over-limit day in a challenge didn''t pass'; end if;
  -- The same day asked about again (a quiz refused, then the deadline's decision) stays let through.
  if not public.ai_limit_day(one, 3) then raise exception 'FAIL: the same over-limit day passed once and then didn''t'; end if;
  if public.ai_limit_day(one, 4) then raise exception 'FAIL: a second over-limit day in the same challenge passed'; end if;
  if public.ai_limit_day(one, 9) then raise exception 'FAIL: a later over-limit day passed'; end if;
  -- And the first day stays the one that passed.
  if not public.ai_limit_day(one, 3) then raise exception 'FAIL: the first day lost its pass to a later one'; end if;
  if not public.ai_limit_day(two, 1) then raise exception 'FAIL: another challenge''s first day didn''t pass'; end if;
end $$;

-- The claim takes a waiting photo check from the user's own time, and says whose it is.
-- C's challenge runs in a zone where it is 10 pm right now (Etc/GMT-n is UTC+n).
do $$
declare
  h int := extract(hour from now() at time zone 'UTC')::int;
  n int := (22 - h + 24) % 24;
  z text := case when n = 0 then 'Etc/GMT' when n <= 14 then 'Etc/GMT-' || n else 'Etc/GMT+' || (24 - n) end;
begin
  perform set_config('test.zone', z, true);
  if extract(hour from now() at time zone z)::int <> 22 then raise exception 'FAIL: the test zone % isn''t at 10 pm', z; end if;
  insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values ('00000000-0000-4000-8000-0000000000c5', 'stretch', 28, 1000, 'aspca', 'card', z, now());
  update public.challenges set start_date = (now() at time zone z)::date
    where user_id = '00000000-0000-4000-8000-0000000000c5';
  perform set_config('test.c_challenge', (select id::text from public.challenges where user_id = '00000000-0000-4000-8000-0000000000c5'), true);
  if (select public.challenge_day(c) from public.challenges c where user_id = '00000000-0000-4000-8000-0000000000c5') <> 1 then
    raise exception 'FAIL: C''s challenge isn''t on Day 1';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c5","role":"authenticated"}', true);
insert into public.check_ins (challenge_id, day, photo_path)
  values (current_setting('test.c_challenge')::uuid, 1, '00000000-0000-4000-8000-0000000000c5/' || current_setting('test.c_challenge') || '/1-1.jpg');
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  c uuid := '00000000-0000-4000-8000-0000000000c5';
  ch uuid := current_setting('test.c_challenge')::uuid;
  n int;
  got record;
begin
  -- 10:00 pm local now. A user who chose 11 pm, or midnight, isn't claimed yet: friends still have the day.
  update public.profiles set ai_from_minutes = 1380 where id = c;
  select count(*) into n from public.ai_check_claim(ch);
  if n <> 0 then raise exception 'FAIL: the AI took a check an hour before its user''s 11 pm'; end if;
  update public.profiles set ai_from_minutes = 1440 where id = c;
  select count(*) into n from public.ai_check_claim(ch);
  if n <> 0 then raise exception 'FAIL: the AI took a check before a midnight user''s day ended'; end if;
  if (select status from public.check_ins where challenge_id = ch) <> 'pending' then raise exception 'FAIL: the check-in moved without being claimed'; end if;

  -- At the default 10 pm it's taken, with whose it is.
  update public.profiles set ai_from_minutes = 1320 where id = c;
  select * into got from public.ai_check_claim(ch);
  if got.id is null then raise exception 'FAIL: the AI didn''t take a check at its user''s 10 pm'; end if;
  if got.user_id <> c or got.challenge_id <> ch then raise exception 'FAIL: the claim doesn''t say whose check-in it is'; end if;
  if got.habit_id <> 'stretch' or got.day <> 1 then raise exception 'FAIL: the claim lost the check-in''s habit or day'; end if;
  if (select status from public.check_ins where challenge_id = ch) <> 'ai_checking' then raise exception 'FAIL: a claimed check-in isn''t ai_checking'; end if;
end $$;

-- One writer at a time for a check-in's quiz questions (C's check-in is ai_checking after the claim above, so a
-- fresh pending one is made: C has a second challenge for it)
do $$
declare
  c uuid := '00000000-0000-4000-8000-0000000000c5';
  ch uuid;
  ci uuid;
begin
  insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values (c, 'read', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now());
  update public.challenges set start_date = (now() at time zone 'America/Los_Angeles')::date where user_id = c and habit_id = 'read';
  select id into ch from public.challenges where user_id = c and habit_id = 'read';
  perform set_config('test.read_challenge', ch::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c5","role":"authenticated"}', true);
insert into public.check_ins (challenge_id, day, photo_path, book, pages)
  values (current_setting('test.read_challenge')::uuid, 1, '00000000-0000-4000-8000-0000000000c5/' || current_setting('test.read_challenge') || '/1-1.jpg', 'A Book', '1-10');
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  ci uuid := (select id from public.check_ins where challenge_id = current_setting('test.read_challenge')::uuid);
begin
  if not public.quiz_claim_write(ci) then raise exception 'FAIL: the first claim to write a quiz was refused'; end if;
  if public.quiz_claim_write(ci) then raise exception 'FAIL: a second writer got the same check-in'; end if;
  -- A claim that is 61 seconds old is stale: the writer died, so the next request may take over.
  update public.check_ins set quiz_writing_at = now() - interval '61 seconds' where id = ci;
  if not public.quiz_claim_write(ci) then raise exception 'FAIL: a stale claim blocked the quiz'; end if;
  -- Released, it can be claimed again at once.
  update public.check_ins set quiz_writing_at = null where id = ci;
  if not public.quiz_claim_write(ci) then raise exception 'FAIL: a released claim stayed taken'; end if;
  -- A check-in that isn't pending any more (a friend approved it) can't be claimed.
  update public.check_ins set quiz_writing_at = null, status = 'ai_checking' where id = ci;
  if public.quiz_claim_write(ci) then raise exception 'FAIL: a check-in that isn''t pending was claimed'; end if;
  -- No app user can run it.
  if has_function_privilege('authenticated', 'public.quiz_claim_write(uuid)', 'execute') then raise exception 'FAIL: an app user can claim a quiz'; end if;
end $$;

-- The quiz bank: a word once per challenge, well-formed, the server's alone
do $$
declare
  ch uuid := current_setting('test.c_challenge')::uuid;
begin
  insert into public.quiz_bank (challenge_id, batch, key, kind, prompt, speak, answer, accepted, tags)
    values (ch, 0, 'hola', 'vocabulary', 'Translate: hello', null, 'hello', array['hi'], array['greetings']);
  begin
    insert into public.quiz_bank (challenge_id, batch, key, kind, prompt, answer) values (ch, 1, 'hola', 'sentence', 'How do you say hello?', 'hello');
    raise exception 'FAIL: the same word went into a challenge''s bank twice';
  exception when unique_violation then null;
  end;
  begin
    insert into public.quiz_bank (challenge_id, batch, key, kind, prompt, answer) values (ch, 1, 'adios', 'trivia', 'x', 'y');
    raise exception 'FAIL: an unknown kind went into the bank';
  exception when check_violation then null;
  end;
  begin
    insert into public.quiz_bank (challenge_id, batch, key, kind, prompt, answer, accepted)
      values (ch, 1, 'adios', 'vocabulary', 'x', 'y', array['1','2','3','4','5','6','7','8','9']);
    raise exception 'FAIL: nine accepted answers went into the bank';
  exception when check_violation then null;
  end;
end $$;

rollback;

select 'PASS: the step-in time is the user''s own and valid; the allowance is 3 per active stake challenge, at least 4; the ceiling counts a rolling 24 hours, releases a failed call and keeps a week; the first over-limit day passes and later ones don''t; the claim follows the user''s time and says whose check-in it is; the bank, log and passes are the server''s alone' as result;
