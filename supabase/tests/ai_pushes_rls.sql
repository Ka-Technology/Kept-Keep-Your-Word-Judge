-- Proves the two pushes about Kept's AI (migration 0087, SPEC-notifications.md section 2): a check-in the AI moves from
-- ai_checking to approved or excused calls `notify` for its result, as a retake and a rejection do; and notify_quiz_open()
-- records, once for each challenge and day, a quiz that is open: Read with a photo waiting, or Learn a language with
-- nothing done, for a user who lets the AI check their days, past their step-in time; never twice, never another habit,
-- never for a user who said no or a day already being checked. quiz_open_pushes is the server's alone.
-- Run on the test project after the migration is pushed: `npx supabase db query --linked --yes -f <this file>`. It runs
-- inside a transaction it rolls back, so nothing stays, and `notify` is never reached (pg_net's queue rolls back too).
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d6', 'aipush-d@kept.test'),
  ('00000000-0000-4000-8000-0000000000e6', 'aipush-e@kept.test'),
  ('00000000-0000-4000-8000-0000000000f6', 'aipush-f@kept.test'),
  ('00000000-0000-4000-8000-000000000096', 'aipush-g@kept.test'),
  ('00000000-0000-4000-8000-0000000000a6', 'aipush-h@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000d6', 'aipush_d', '1990-01-01', 'NY'),
  ('00000000-0000-4000-8000-0000000000e6', 'aipush_e', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000f6', 'aipush_f', '1990-01-01', 'TX'),
  ('00000000-0000-4000-8000-000000000096', 'aipush_g', '1990-01-01', 'WA'),
  ('00000000-0000-4000-8000-0000000000a6', 'aipush_h', '1990-01-01', 'OR');
-- D, E, G and H let the AI check their days; F said no.
update public.profiles set ai_allowed = true
  where id in ('00000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000e6',
               '00000000-0000-4000-8000-000000000096', '00000000-0000-4000-8000-0000000000a6');
update public.profiles set ai_allowed = false where id = '00000000-0000-4000-8000-0000000000f6';

-- The server's alone
do $$
begin
  if has_table_privilege('authenticated', 'public.quiz_open_pushes', 'select') or has_table_privilege('authenticated', 'public.quiz_open_pushes', 'insert')
     or has_table_privilege('anon', 'public.quiz_open_pushes', 'select') or has_table_privilege('anon', 'public.quiz_open_pushes', 'insert') then
    raise exception 'FAIL: an app user can reach quiz_open_pushes';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.quiz_open_pushes'::regclass) then
    raise exception 'FAIL: RLS is off on quiz_open_pushes';
  end if;
  if has_function_privilege('authenticated', 'public.notify_quiz_open()', 'execute') or has_function_privilege('anon', 'public.notify_quiz_open()', 'execute') then
    raise exception 'FAIL: an app user can run notify_quiz_open';
  end if;
  if not has_function_privilege('service_role', 'public.notify_quiz_open()', 'execute') then
    raise exception 'FAIL: the service role can''t run notify_quiz_open';
  end if;
end $$;

-- Challenges, all in a zone where it is 10 pm right now (Etc/GMT-n is UTC+n), on Day 1.
-- D: Learn a language; E and H: Read; F: Read, but no to the AI; G: Stretch.
do $$
declare
  h int := extract(hour from now() at time zone 'UTC')::int;
  n int := (22 - h + 24) % 24;
  z text := case when n = 0 then 'Etc/GMT' when n <= 14 then 'Etc/GMT-' || n else 'Etc/GMT+' || (24 - n) end;
begin
  if extract(hour from now() at time zone z)::int <> 22 then raise exception 'FAIL: the test zone % isn''t at 10 pm', z; end if;
  insert into public.challenges (user_id, habit_id, language, level, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values ('00000000-0000-4000-8000-0000000000d6', 'language', 'spanish', 'beginner', 28, 1000, 'aspca', 'card', z, now());
  insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at) values
    ('00000000-0000-4000-8000-0000000000e6', 'read', 28, 1000, 'aspca', 'card', z, now()),
    ('00000000-0000-4000-8000-0000000000f6', 'read', 28, 1000, 'aspca', 'card', z, now()),
    ('00000000-0000-4000-8000-000000000096', 'stretch', 28, 1000, 'aspca', 'card', z, now()),
    ('00000000-0000-4000-8000-0000000000a6', 'read', 28, 1000, 'aspca', 'card', z, now());
  update public.challenges set start_date = (now() at time zone z)::date
    where user_id in ('00000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-0000000000f6',
                      '00000000-0000-4000-8000-000000000096', '00000000-0000-4000-8000-0000000000a6');
end $$;

-- E, F and H send a Read photo (a check-in waiting for friends); G sends a Stretch photo.
do $$
declare
  u uuid;
  ch uuid;
  habit text;
begin
  for u, habit in values
    ('00000000-0000-4000-8000-0000000000e6'::uuid, 'read'), ('00000000-0000-4000-8000-0000000000f6'::uuid, 'read'),
    ('00000000-0000-4000-8000-0000000000a6'::uuid, 'read'), ('00000000-0000-4000-8000-000000000096'::uuid, 'stretch') loop
    select id into ch from public.challenges where user_id = u;
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    set local role authenticated;
    if habit = 'read' then
      insert into public.check_ins (challenge_id, day, photo_path, book, pages) values (ch, 1, u || '/' || ch || '/1-1.jpg', 'A Book', '1-10');
    else
      insert into public.check_ins (challenge_id, day, photo_path) values (ch, 1, u || '/' || ch || '/1-1.jpg');
    end if;
    reset role;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  -- H's day is already being checked by the AI: no quiz is needed.
  update public.check_ins set status = 'ai_checking'
    where challenge_id = (select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a6');
end $$;

-- The quiz opening
do $$
declare
  pushed text[];
begin
  perform public.notify_quiz_open();
  select array_agg(c.user_id::text order by c.user_id) into pushed
    from public.quiz_open_pushes q join public.challenges c on c.id = q.challenge_id
    where c.user_id in ('00000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-0000000000f6',
                        '00000000-0000-4000-8000-000000000096', '00000000-0000-4000-8000-0000000000a6');
  -- Only D (Learn a language with nothing done) and E (Read with a photo waiting): not F (no to the AI), G (Stretch)
  -- or H (already being checked).
  if pushed is distinct from array['00000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000e6'] then
    raise exception 'FAIL: the quiz pushes went to %, not to D and E', pushed;
  end if;
  -- Never twice for the same day.
  perform public.notify_quiz_open();
  if (select count(*) from public.quiz_open_pushes q join public.challenges c on c.id = q.challenge_id
      where c.user_id in ('00000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000e6')) <> 2 then
    raise exception 'FAIL: a day was pushed twice';
  end if;
end $$;

-- A user whose step-in time hasn't come isn't pushed: E asks for 11 pm, and it is 10 pm.
do $$
declare
  e uuid := '00000000-0000-4000-8000-0000000000e6';
begin
  delete from public.quiz_open_pushes where challenge_id = (select id from public.challenges where user_id = e);
  update public.profiles set ai_from_minutes = 1380 where id = e;
  perform public.notify_quiz_open();
  if exists (select 1 from public.quiz_open_pushes where challenge_id = (select id from public.challenges where user_id = e)) then
    raise exception 'FAIL: the quiz opened an hour before its user''s 11 pm';
  end if;
  -- Midnight opens the quiz at 11 pm, never later, so at 10 pm it isn't open either.
  update public.profiles set ai_from_minutes = 1440 where id = e;
  perform public.notify_quiz_open();
  if exists (select 1 from public.quiz_open_pushes where challenge_id = (select id from public.challenges where user_id = e)) then
    raise exception 'FAIL: a midnight user''s quiz opened at 10 pm';
  end if;
  -- And at 9 pm (a time before now) it is open.
  update public.profiles set ai_from_minutes = 1260 where id = e;
  perform public.notify_quiz_open();
  if not exists (select 1 from public.quiz_open_pushes where challenge_id = (select id from public.challenges where user_id = e)) then
    raise exception 'FAIL: the quiz stayed closed after its user''s step-in time';
  end if;
end $$;

-- The result push: the trigger calls notify when the AI approves or excuses a day. G's check-in is approved, and
-- H's (already being checked) is excused.
do $$
declare
  approved uuid := (select id from public.check_ins where challenge_id = (select id from public.challenges where user_id = '00000000-0000-4000-8000-000000000096'));
  excused uuid := (select id from public.check_ins where challenge_id = (select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a6'));
  before_calls int;
  after_calls int;
begin
  -- pg_net's queue, when this server has it: a row per call made in this transaction.
  if to_regclass('net.http_request_queue') is null then return; end if;
  update public.check_ins set status = 'ai_checking' where id = approved;
  select count(*) into before_calls from net.http_request_queue where convert_from(body, 'utf8') like '%"check_in_result"%' and convert_from(body, 'utf8') like '%' || approved || '%';
  update public.check_ins set status = 'approved' where id = approved;
  select count(*) into after_calls from net.http_request_queue where convert_from(body, 'utf8') like '%"check_in_result"%' and convert_from(body, 'utf8') like '%' || approved || '%';
  if after_calls <> before_calls + 1 then raise exception 'FAIL: the AI''s approval didn''t call notify'; end if;

  select count(*) into before_calls from net.http_request_queue where convert_from(body, 'utf8') like '%"check_in_result"%' and convert_from(body, 'utf8') like '%' || excused || '%';
  update public.check_ins set status = 'excused' where id = excused;
  select count(*) into after_calls from net.http_request_queue where convert_from(body, 'utf8') like '%"check_in_result"%' and convert_from(body, 'utf8') like '%' || excused || '%';
  if after_calls <> before_calls + 1 then raise exception 'FAIL: counting a day without the AI didn''t call notify'; end if;
end $$;

rollback;

select 'PASS: the AI''s approval and a counted day call notify; the quiz-open push goes once for each challenge and day, to Read with a photo waiting and Learn a language with nothing done, for a user who allows the AI and whose step-in time has come, and to no one else; the log is the server''s alone' as result;
