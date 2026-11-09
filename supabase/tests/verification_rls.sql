-- Proves the verification module's database rules (migrations 0013-0020, T25-T29 and T42,
-- SPEC-verification.md): the new statuses; check-ins created only as pending; the challenger's part
-- of the change rules (a new photo while pending, after a friend's "doesn't look right", or after
-- the AI's retake; nothing else); an eligible friend's part (approve, or ask for a new photo with a
-- note; never reject; only friends from before Day 1 who pledged, T60); photos only in the challenger's own folder with the time set by the database; and the
-- private check-in-photos bucket (the challenger and friends read, unfriending ends it, strangers
-- get nothing); and the AI job's part (T27: only the service role moves check-ins into and out of
-- ai_checking, which due ones it takes, a run that died counting as done, "Next day" through the
-- server, and which photos are due for deletion); and the real verdict's (T28: one retake per
-- check-in, a new photo after it checked at once, an unanswered retake from an ended day rejected);
-- and appeals (T29: the challenger only, once, within 7 days, with a note; the owner decides and may
-- clear an outcome); and quizzes (T42: written only by the AI job, while the check-in waits).
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/verification_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a3', 'verify-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b3', 'verify-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000c3', 'verify-c@kept.test'),
  ('00000000-0000-4000-8000-0000000000d3', 'verify-d@kept.test');

insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a3', 'ver_test_a', '1990-01-01', 'NY'),
  ('00000000-0000-4000-8000-0000000000b3', 'ver_test_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000c3', 'ver_test_c', '1990-01-01', 'TX'),
  ('00000000-0000-4000-8000-0000000000d3', 'ver_test_d', '1990-01-01', 'WA');
-- A and D allowed Kept's AI to check their days (T54); E and F below didn't.
update public.profiles set ai_allowed = true where id in ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000d3');

-- A's challenge started 3 days ago, so today is Day 4. B has been A's friend for 10 days (before
-- Day 1, so B may review); D became A's friend just now (after Day 1, so D may not); C is a stranger.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000a3', 'workout', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now());
update public.challenges set start_date = (now() at time zone 'America/Los_Angeles')::date - 3
  where user_id = '00000000-0000-4000-8000-0000000000a3';
select set_config('test.challenge', (select id::text from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a3'), true);
select set_config('test.day', (select public.challenge_day(c)::text from public.challenges c where user_id = '00000000-0000-4000-8000-0000000000a3'), true);
insert into public.friendships (requester_id, addressee_id, status, accepted_at, created_at) values
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000b3', 'accepted', now() - interval '10 days', now() - interval '10 days'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000d3', 'accepted', now(), now());

-- Privileges, the statuses and the bucket
do $$
begin
  if current_setting('test.day') <> '4' then raise exception 'FAIL: the test challenge isn''t on Day 4'; end if;
  if (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'check_ins' and column_name = 'status') <> '''pending''::text' then
    raise exception 'FAIL: a new check-in isn''t pending by default';
  end if;
  if has_column_privilege('authenticated', 'public.check_ins', 'status', 'insert')
     or has_column_privilege('authenticated', 'public.check_ins', 'photo_taken_at', 'insert')
     or has_column_privilege('authenticated', 'public.check_ins', 'photo_taken_at', 'update')
     or has_column_privilege('authenticated', 'public.check_ins', 'reviewer_id', 'update')
     or has_column_privilege('authenticated', 'public.check_ins', 'reviewed_at', 'update')
     or has_column_privilege('authenticated', 'public.check_ins', 'day', 'update')
     or has_column_privilege('authenticated', 'public.check_ins', 'challenge_id', 'update') then
    raise exception 'FAIL: authenticated can set a check-in column it must not';
  end if;
  if not has_column_privilege('authenticated', 'public.check_ins', 'photo_path', 'insert')
     or not has_column_privilege('authenticated', 'public.check_ins', 'book', 'insert')
     or not has_column_privilege('authenticated', 'public.check_ins', 'pages', 'insert')
     or not has_column_privilege('authenticated', 'public.check_ins', 'photo_path', 'update')
     or not has_column_privilege('authenticated', 'public.check_ins', 'flag_note', 'update')
     or not has_column_privilege('authenticated', 'public.check_ins', 'appeal_note', 'update') then
    raise exception 'FAIL: authenticated cannot send a photo, book, pages or a flag note';
  end if;
  if has_function_privilege('anon', 'public.check_ins_to_review()', 'execute') then
    raise exception 'FAIL: anon can list check-ins to review';
  end if;
  if has_function_privilege('authenticated', 'public.ai_check_claim(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.demo_next_day(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.expired_check_in_photos()', 'execute')
     or has_function_privilege('anon', 'public.ai_check_claim(uuid)', 'execute')
     or has_column_privilege('authenticated', 'public.check_ins', 'ai_checked_at', 'update')
     or has_column_privilege('authenticated', 'public.check_ins', 'ai_verdict', 'update')
     or has_column_privilege('authenticated', 'public.check_ins', 'ai_reason', 'update')
     or has_column_privilege('authenticated', 'public.check_ins', 'retake_asked', 'update')
     or has_column_privilege('authenticated', 'public.check_ins', 'appealed_at', 'update')
     or has_column_privilege('authenticated', 'public.check_ins', 'appeal_decided_at', 'update')
     or has_column_privilege('authenticated', 'public.check_ins', 'owner_note', 'update')
     or has_column_privilege('authenticated', 'public.check_ins', 'quiz', 'update') then
    raise exception 'FAIL: an app user can run the AI job or set its time';
  end if;
  if not has_function_privilege('service_role', 'public.ai_check_claim(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.demo_next_day(uuid, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.expired_check_in_photos()', 'execute') then
    raise exception 'FAIL: the service role can''t run the AI job';
  end if;
  if not exists (select 1 from storage.buckets where id = 'check-in-photos' and not public) then
    raise exception 'FAIL: the private check-in-photos bucket is missing';
  end if;
end $$;

-- As A, the challenger
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);

do $$
declare
  ch uuid := current_setting('test.challenge')::uuid;
  today int := current_setting('test.day')::int;
  own text := '00000000-0000-4000-8000-0000000000a3/' || current_setting('test.challenge') || '/';
  n int;
  msg text;
begin
  -- A photo in someone else's folder, or another challenge's, is refused.
  begin
    insert into public.check_ins (challenge_id, day, photo_path) values (ch, today, '00000000-0000-4000-8000-0000000000b3/x/1-1.jpg');
    raise exception 'FAIL: A saved a photo path outside their own folder';
  exception when check_violation then get stacked diagnostics msg = message_text;
    if msg <> 'check_in_photo_not_own' then raise; end if;
  end;

  -- Checking in: pending, and the database stamps the time.
  insert into public.check_ins (challenge_id, day, photo_path) values (ch, today, own || '4-1.jpg');
  select count(*) into n from public.check_ins where challenge_id = ch and status = 'pending' and photo_taken_at is not null;
  if n <> 1 then raise exception 'FAIL: the check-in isn''t pending with a photo time'; end if;

  -- A new photo before anyone reviews it (#2).
  update public.check_ins set photo_path = own || '4-2.jpg' where challenge_id = ch;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A could not retake before a review'; end if;

  -- Nothing else: not approving or flagging their own day, not clearing the photo, not writing a flag note.
  begin
    update public.check_ins set status = 'approved' where challenge_id = ch;
    raise exception 'FAIL: A approved their own check-in';
  exception when check_violation then null;
  end;
  begin
    update public.check_ins set status = 'flagged' where challenge_id = ch;
    raise exception 'FAIL: A flagged their own check-in';
  exception when check_violation then null;
  end;
  begin
    update public.check_ins set photo_path = null where challenge_id = ch;
    raise exception 'FAIL: A removed the photo from a check-in';
  exception when check_violation then null;
  end;
  begin
    update public.check_ins set flag_note = 'looks fine to me' where challenge_id = ch;
    raise exception 'FAIL: A wrote a flag note on their own check-in';
  exception when check_violation then null;
  end;
  select count(*) into n from public.check_ins_to_review();
  if n <> 0 then raise exception 'FAIL: A is asked to review their own check-in'; end if;

  -- Photo files: only in A's own folder.
  insert into storage.objects (bucket_id, name) values ('check-in-photos', own || '4-2.jpg');
  begin
    insert into storage.objects (bucket_id, name) values ('check-in-photos', '00000000-0000-4000-8000-0000000000b3/x/1-1.jpg');
    raise exception 'FAIL: A uploaded into another user''s check-in folder';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The AI (as the service role, T27) takes it and asks for a retake; A's new photo sends it back to
-- pending (#11). The AI job can't skip ai_checking.
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
begin
  update public.check_ins set status = 'retake' where challenge_id = current_setting('test.challenge')::uuid;
  raise exception 'FAIL: the AI job decided without taking the check-in first';
exception when check_violation then null;
end $$;
update public.check_ins set status = 'ai_checking' where challenge_id = current_setting('test.challenge')::uuid;
update public.check_ins set status = 'retake' where challenge_id = current_setting('test.challenge')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);

do $$
declare
  ch uuid := current_setting('test.challenge')::uuid;
  own text := '00000000-0000-4000-8000-0000000000a3/' || current_setting('test.challenge') || '/';
  n int;
begin
  begin
    update public.check_ins set status = 'pending' where challenge_id = ch;
    raise exception 'FAIL: A answered a retake without a new photo';
  exception when check_violation then null;
  end;
  update public.check_ins set status = 'pending', photo_path = own || '4-3.jpg' where challenge_id = ch;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A could not send a retake'; end if;
end $$;

-- As B, A's friend since before Day 1: reads the check-in and photo, approves, or sends it to the AI.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);

-- Until B backs A with a pledge, B reads but can't check A's days (T60, owner 2026-09-29).
do $$
declare
  ch uuid := current_setting('test.challenge')::uuid;
  n int;
begin
  select count(*) into n from public.check_ins_to_review();
  if n <> 0 then raise exception 'FAIL: B is asked to review without having pledged'; end if;
  update public.check_ins set status = 'approved' where challenge_id = ch;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B approved a check-in without having pledged'; end if;
  insert into public.pledges (challenge_id, amount_cents) values (ch, 500);
end $$;

do $$
declare
  ch uuid := current_setting('test.challenge')::uuid;
  n int;
begin
  select count(*) into n from public.check_ins where challenge_id = ch;
  if n <> 1 then raise exception 'FAIL: B reads % of A''s check-ins, expected 1', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'check-in-photos';
  if n <> 1 then raise exception 'FAIL: B reads % of A''s photos, expected 1', n; end if;
  select count(*) into n from public.check_ins_to_review() where challenger_id = '00000000-0000-4000-8000-0000000000a3';
  if n <> 1 then raise exception 'FAIL: B isn''t asked to review A''s check-in'; end if;
  begin
    insert into public.check_ins (challenge_id, day) values (ch, current_setting('test.day')::int);
    raise exception 'FAIL: B checked in on A''s challenge';
  exception when insufficient_privilege then null;
  end;

  -- No friend can fail a day (the pledger rule), or change the photo.
  begin
    update public.check_ins set status = 'rejected' where challenge_id = ch;
    raise exception 'FAIL: B rejected A''s check-in';
  exception when check_violation then null;
  end;
  begin
    update public.check_ins set status = 'approved', photo_path = '00000000-0000-4000-8000-0000000000b3/x.jpg' where challenge_id = ch;
    raise exception 'FAIL: B changed A''s photo';
  exception when check_violation then null;
  end;

  -- Approve (#3): the database records who and when.
  update public.check_ins set status = 'approved' where challenge_id = ch;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: B could not approve'; end if;
  if not exists (select 1 from public.check_ins where challenge_id = ch
                 and reviewer_id = '00000000-0000-4000-8000-0000000000b3' and reviewed_at is not null) then
    raise exception 'FAIL: the approval didn''t record B as the reviewer';
  end if;
  -- Only while pending.
  begin
    update public.check_ins set status = 'flagged' where challenge_id = ch;
    raise exception 'FAIL: B flagged a check-in that was already approved';
  exception when check_violation then null;
  end;
  select count(*) into n from public.check_ins_to_review();
  if n <> 0 then raise exception 'FAIL: an approved check-in still waits for review'; end if;
end $$;

-- A fresh pending check-in (set back by the owner), which B says doesn't look right, with a note (#4).
reset role;
select set_config('request.jwt.claims', '', true);
update public.check_ins set status = 'pending', reviewer_id = null, reviewed_at = null, retake_asked = false
  where challenge_id = current_setting('test.challenge')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);

do $$
declare
  ch uuid := current_setting('test.challenge')::uuid;
  n int;
begin
  update public.check_ins set status = 'flagged', flag_note = 'That looks like a photo of a screen' where challenge_id = ch;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: B could not ask A for a new photo'; end if;
  if not exists (select 1 from public.check_ins where challenge_id = ch and status = 'flagged'
                 and flag_note = 'That looks like a photo of a screen' and reviewer_id = '00000000-0000-4000-8000-0000000000b3') then
    raise exception 'FAIL: the flag didn''t record the note and B';
  end if;
end $$;

-- A resubmits a new photo, replacing the flagged one (#12, owner 2026-09-26): back to pending,
-- and the flag is cleared, so friends review the new photo.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);

do $$
declare
  ch uuid := current_setting('test.challenge')::uuid;
  own text := '00000000-0000-4000-8000-0000000000a3/' || current_setting('test.challenge') || '/';
  n int;
begin
  begin
    update public.check_ins set status = 'pending' where challenge_id = ch;
    raise exception 'FAIL: A cleared a friend''s flag without a new photo';
  exception when check_violation then null;
  end;
  update public.check_ins set status = 'pending', photo_path = own || '4-4.jpg' where challenge_id = ch;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A could not resubmit after a friend''s flag'; end if;
  if not exists (select 1 from public.check_ins where challenge_id = ch and status = 'pending'
                 and flag_note is null and reviewer_id is null and reviewed_at is null) then
    raise exception 'FAIL: resubmitting didn''t clear the flag for a fresh review';
  end if;
end $$;

-- As D, A's friend only since after Day 1: reads, but can't review (SPEC.md open question 13),
-- even after pledging (T60 adds the pledge to the Day 1 rule, not in place of it).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d3","role":"authenticated"}', true);

do $$
declare
  ch uuid := current_setting('test.challenge')::uuid;
  n int;
begin
  insert into public.pledges (challenge_id, amount_cents) values (ch, 500);
  select count(*) into n from public.check_ins where challenge_id = ch;
  if n <> 1 then raise exception 'FAIL: D, a friend, can''t read A''s check-in'; end if;
  select count(*) into n from public.check_ins_to_review();
  if n <> 0 then raise exception 'FAIL: D is asked to review a challenge that started before the friendship'; end if;
  update public.check_ins set status = 'approved' where challenge_id = ch;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: D approved a challenge that started before the friendship'; end if;
end $$;

-- As C, a stranger: nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.check_ins;
  if n <> 0 then raise exception 'FAIL: C reads % check-ins', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'check-in-photos';
  if n <> 0 then raise exception 'FAIL: C reads % check-in photos', n; end if;
  select count(*) into n from public.check_ins_to_review();
  if n <> 0 then raise exception 'FAIL: C is asked to review % check-ins', n; end if;
  update public.check_ins set status = 'approved';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: C approved a stranger''s check-in'; end if;
end $$;

-- A unfriends B: B loses the photo and the review at once
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
delete from public.friendships where addressee_id = '00000000-0000-4000-8000-0000000000b3';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from storage.objects where bucket_id = 'check-in-photos';
  if n <> 0 then raise exception 'FAIL: B still reads A''s photo after unfriending'; end if;
  select count(*) into n from public.check_ins_to_review();
  if n <> 0 then raise exception 'FAIL: B can still review after unfriending'; end if;
end $$;

-- A check-in without a photo (Learn a language, until T42's quiz) is checked in again after a
-- friend's flag, since there's no photo to replace (owner, 2026-09-27; migration 0017). The owner
-- adds day 1, photo-less and flagged by B.
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.check_ins (challenge_id, day, status, flag_note, reviewer_id, reviewed_at)
  values (current_setting('test.challenge')::uuid, 1, 'flagged', 'Which words did you practice?',
          '00000000-0000-4000-8000-0000000000b3', now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);

do $$
declare
  ch uuid := current_setting('test.challenge')::uuid;
  n int;
begin
  update public.check_ins set status = 'pending', photo_path = null where challenge_id = ch and day = 1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A couldn''t check in again after a flag on a check-in without a photo'; end if;
  if not exists (select 1 from public.check_ins where challenge_id = ch and day = 1 and status = 'pending'
                 and flag_note is null and reviewer_id is null and reviewed_at is null) then
    raise exception 'FAIL: checking in again didn''t clear the flag for a fresh review';
  end if;
  -- Only after a flag.
  begin
    update public.check_ins set status = 'pending', photo_path = null where challenge_id = ch and day = 1;
    raise exception 'FAIL: A checked in again without a friend''s flag';
  exception when check_violation then null;
  end;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
delete from public.check_ins where challenge_id = current_setting('test.challenge')::uuid and day = 1;
set local role authenticated;

-- The AI job (T27). A's day 4 is pending again. The owner adds day 2, flagged with a note and no new
-- photo, and day 3, still pending: both days have ended.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);

do $$
begin
  update public.check_ins set status = 'ai_checking' where challenge_id = current_setting('test.challenge')::uuid;
  raise exception 'FAIL: A sent their own check-in to the AI';
exception when check_violation then null;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
insert into public.check_ins (challenge_id, day, status, flag_note) values
  (current_setting('test.challenge')::uuid, 2, 'flagged', 'Too dark to see the bar'),
  (current_setting('test.challenge')::uuid, 3, 'pending', null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  ch uuid := current_setting('test.challenge')::uuid;
  -- Today (day 4) is due only in its last 2 hours, from 10 pm in the challenge's zone.
  late boolean := (now() at time zone 'America/Los_Angeles')::time >= '22:00';
  n int;
  noted int;
begin
  select count(*), count(*) filter (where day = 2 and flag_note = 'Too dark to see the bar')
    into n, noted from public.ai_check_claim(ch);
  if n <> (case when late then 3 else 2 end) then raise exception 'FAIL: the AI job took % check-ins (late: %)', n, late; end if;
  if noted <> 1 then raise exception 'FAIL: the flagged day didn''t reach the AI with the friend''s note'; end if;
  if (select count(*) from public.check_ins where challenge_id = ch and day in (2, 3)
      and status = 'ai_checking' and ai_checked_at is not null) <> 2 then
    raise exception 'FAIL: the ended days aren''t being checked, with the time recorded';
  end if;
  select count(*) into n from public.ai_check_claim(ch);
  if n <> 0 then raise exception 'FAIL: a second run took % check-ins again', n; end if;

  -- The stub verdict: approve (#7).
  update public.check_ins set status = 'approved' where challenge_id = ch and day = 3;
end $$;

-- While the AI has it, the challenger can't change it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);

do $$
declare ch uuid := current_setting('test.challenge')::uuid;
begin
  update public.check_ins set status = 'pending', photo_path = '00000000-0000-4000-8000-0000000000a3/' || ch || '/2-9.jpg'
    where challenge_id = ch and day = 2;
  raise exception 'FAIL: A changed a check-in the AI is checking';
exception when check_violation then null;
end $$;

-- A run that died leaves day 2 in ai_checking. After 10 minutes the next run counts it as done
-- (#10): a Kept error is never the challenger's miss.
reset role;
select set_config('request.jwt.claims', '', true);
update public.check_ins set ai_checked_at = now() - interval '11 minutes'
  where challenge_id = current_setting('test.challenge')::uuid and day = 2;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare ch uuid := current_setting('test.challenge')::uuid;
begin
  perform public.ai_check_claim(ch);
  if (select status from public.check_ins where challenge_id = ch and day = 2) <> 'excused' then
    raise exception 'FAIL: a check-in stuck with the AI wasn''t counted as done';
  end if;
  begin
    update public.check_ins set status = 'pending' where challenge_id = ch and day = 3;
    raise exception 'FAIL: the AI job moved an approved check-in';
  exception when check_violation then null;
  end;
end $$;

-- "Next day (demo)" goes through the server: the app can't move the clock itself.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);

do $$
begin
  update public.challenges set day_offset = 1 where id = current_setting('test.challenge')::uuid;
  raise exception 'FAIL: A moved the demo clock without the server';
exception when insufficient_privilege then null;
end $$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare ch uuid := current_setting('test.challenge')::uuid;
begin
  if public.demo_next_day(ch, '00000000-0000-4000-8000-0000000000b3') then
    raise exception 'FAIL: B moved A''s demo clock';
  end if;
  if not public.demo_next_day(ch, '00000000-0000-4000-8000-0000000000a3') then
    raise exception 'FAIL: A''s "Next day" didn''t move the clock';
  end if;
  if (select public.challenge_day(c) from public.challenges c where id = ch) <> 5 then
    raise exception 'FAIL: "Next day" didn''t make it Day 5';
  end if;
  -- Day 4 has ended, so the same run as a real deadline takes it.
  perform public.ai_check_claim(ch);
  if (select status from public.check_ins where challenge_id = ch and day = 4) <> 'ai_checking' then
    raise exception 'FAIL: the day "Next day" ended wasn''t checked';
  end if;

  -- The real verdict (T28): the AI asks for a retake, recorded with its reason, once per check-in.
  update public.check_ins set status = 'retake', ai_verdict = 'retake', ai_reason = 'Too dark to see the bar', ai_model = 'claude-haiku-4-5'
    where challenge_id = ch and day = 4;
  if not (select retake_asked from public.check_ins where challenge_id = ch and day = 4) then
    raise exception 'FAIL: the database didn''t mark the retake as asked';
  end if;
end $$;

-- A answers the retake with a new photo (#11).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
update public.check_ins set status = 'pending', photo_path = '00000000-0000-4000-8000-0000000000a3/' || current_setting('test.challenge') || '/4-5.jpg'
  where challenge_id = current_setting('test.challenge')::uuid and day = 4;

-- The owner adds day 5 (today) waiting on a retake, and day 1, a retake never answered.
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.check_ins (challenge_id, day, status, retake_asked) values
  (current_setting('test.challenge')::uuid, 5, 'retake', true),
  (current_setting('test.challenge')::uuid, 1, 'retake', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
update public.check_ins set status = 'pending', photo_path = '00000000-0000-4000-8000-0000000000a3/' || current_setting('test.challenge') || '/5-1.jpg'
  where challenge_id = current_setting('test.challenge')::uuid and day = 5;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  ch uuid := current_setting('test.challenge')::uuid;
  asked boolean;
begin
  perform 1 from public.ai_check_claim(ch) r where r.day = 4 and r.retake_asked and r.day_ended;
  if not found then raise exception 'FAIL: the retaken day 4 wasn''t checked again as ended, with its retake used'; end if;
  -- Day 5 was retaken today: checked at once, not at 10 pm, and its day is still open.
  if (select status from public.check_ins where challenge_id = ch and day = 5) <> 'ai_checking' then
    raise exception 'FAIL: a new photo after a retake wasn''t checked at once';
  end if;
  -- A retake still unanswered when its day ended is not approved (#13).
  if (select status from public.check_ins where challenge_id = ch and day = 1) <> 'rejected' then
    raise exception 'FAIL: an unanswered retake from an ended day wasn''t rejected';
  end if;

  -- Only one retake per check-in.
  begin
    update public.check_ins set status = 'retake' where challenge_id = ch and day = 4;
    raise exception 'FAIL: the AI asked for a second retake';
  exception when check_violation then null;
  end;
  update public.check_ins set status = 'approved', ai_verdict = 'unsure', ai_reason = null where challenge_id = ch and day = 4;
  select retake_asked into asked from public.check_ins where challenge_id = ch and day = 4;
  if not asked then raise exception 'FAIL: the AI job cleared the retake'; end if;

  -- The AI turns down day 5 (for the appeals below).
  update public.check_ins set status = 'rejected', ai_verdict = 'not_approved', ai_reason = 'That’s a laptop screen'
    where challenge_id = ch and day = 5;
end $$;

-- Appeals (T29, #14-#16). Days 1 and 5 were just rejected; the owner adds day 6, rejected 8 days ago.
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.check_ins (challenge_id, day, status, ai_checked_at)
  values (current_setting('test.challenge')::uuid, 6, 'rejected', now() - interval '8 days');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);

do $$
declare
  ch uuid := current_setting('test.challenge')::uuid;
  n int;
begin
  begin
    update public.check_ins set status = 'appealed' where challenge_id = ch and day = 1;
    raise exception 'FAIL: A appealed without a note';
  exception when check_violation then null;
  end;
  update public.check_ins set status = 'appealed', appeal_note = 'I cooked; the light was off' where challenge_id = ch and day = 1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A couldn''t appeal a rejected day'; end if;
  if (select appealed_at from public.check_ins where challenge_id = ch and day = 1) is null then
    raise exception 'FAIL: the database didn''t record when A appealed';
  end if;
  begin
    update public.check_ins set status = 'appealed', appeal_note = 'Too late?' where challenge_id = ch and day = 6;
    raise exception 'FAIL: A appealed more than 7 days after the rejection';
  exception when check_violation then null;
  end;
  begin
    update public.check_ins set status = 'appealed', appeal_note = 'Just because' where challenge_id = ch and day = 3;
    raise exception 'FAIL: A appealed a day that wasn''t rejected';
  exception when check_violation then null;
  end;
  begin
    update public.check_ins set appeal_note = 'A note without an appeal' where challenge_id = ch and day = 3;
    raise exception 'FAIL: A wrote an appeal note without appealing';
  exception when check_violation then null;
  end;
  update public.check_ins set status = 'appealed', appeal_note = 'It was the recipe on my laptop, then the stove' where challenge_id = ch and day = 5;
end $$;

-- D, a friend, can't appeal A's day.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d3","role":"authenticated"}', true);

do $$
declare n int;
begin
  update public.check_ins set status = 'appealed', appeal_note = 'On their behalf' where challenge_id = current_setting('test.challenge')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a friend appealed the challenger''s day'; end if;
end $$;

-- The owner restores day 1 (#15) and upholds day 5 with a note (#16); the database records when.
reset role;
select set_config('request.jwt.claims', '', true);
update public.check_ins set status = 'excused' where challenge_id = current_setting('test.challenge')::uuid and day = 1;
update public.check_ins set status = 'rejected', owner_note = 'The photo shows a screen, not the stove'
  where challenge_id = current_setting('test.challenge')::uuid and day = 5;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);

do $$
declare ch uuid := current_setting('test.challenge')::uuid;
begin
  if (select count(*) from public.check_ins where challenge_id = ch and day in (1, 5) and appeal_decided_at is not null) <> 2 then
    raise exception 'FAIL: the owner''s decisions weren''t recorded';
  end if;
  -- Once per check-in: an upheld appeal can't be appealed again.
  update public.check_ins set status = 'appealed', appeal_note = 'Please look again' where challenge_id = ch and day = 5;
  raise exception 'FAIL: A appealed the same day twice';
exception when check_violation then null;
end $$;

-- Quizzes (T42): only the AI job writes a quiz, and only while the check-in waits; that isn't a
-- verdict, so no AI time is stamped. The job's run hands each quiz to the deadline decision.
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.check_ins (challenge_id, day, status) values (current_setting('test.challenge')::uuid, 7, 'pending');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare ch uuid := current_setting('test.challenge')::uuid;
begin
  update public.check_ins set quiz = '{"attempts": [{"questions": [{"kind": "vocabulary", "prompt": "¿Qué es una manzana?"}]}]}'
    where challenge_id = ch and day = 7;
  if not exists (select 1 from public.check_ins where challenge_id = ch and day = 7 and status = 'pending'
                 and quiz is not null and ai_checked_at is null) then
    raise exception 'FAIL: the AI job couldn''t write a quiz on a waiting check-in, or stamped it as a verdict';
  end if;
  begin
    update public.check_ins set quiz = '{"attempts": []}' where challenge_id = ch and day = 4;
    raise exception 'FAIL: the AI job rewrote the quiz on a decided check-in';
  exception when check_violation then null;
  end;
  perform r.quiz from public.ai_check_claim(ch) r;
end $$;

-- The quiz window (owner, 2026-09-27): from 10 pm, Read and Learn a language wait for the
-- challenger's quiz, so the AI job's 10 pm runs leave them to the day's end; other habits are still
-- checked from 10 pm. D gets a Read and a Stretch challenge, on Day 4, in a zone where it's now
-- after 10 pm.
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('test.late_zone', (select name from pg_timezone_names
  where (now() at time zone name)::time between '22:00' and '23:30' order by name limit 1), true);
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000d3', 'read', 28, 1000, 'aspca', 'card', current_setting('test.late_zone'), now()),
         ('00000000-0000-4000-8000-0000000000d3', 'stretch', 28, 1000, 'aspca', 'card', current_setting('test.late_zone'), now());
update public.challenges set start_date = (now() at time zone time_zone)::date - 3
  where user_id = '00000000-0000-4000-8000-0000000000d3';
insert into public.check_ins (challenge_id, day, status)
  select id, 4, 'pending' from public.challenges where user_id = '00000000-0000-4000-8000-0000000000d3';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  read_ch uuid := (select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000d3' and habit_id = 'read');
  stretch_ch uuid := (select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000d3' and habit_id = 'stretch');
begin
  perform public.ai_check_claim(stretch_ch);
  perform public.ai_check_claim(read_ch);
  if (select status from public.check_ins where challenge_id = stretch_ch) <> 'ai_checking' then
    raise exception 'FAIL: the 10 pm run skipped a photo habit (zone %)', current_setting('test.late_zone');
  end if;
  if (select status from public.check_ins where challenge_id = read_ch) <> 'pending' then
    raise exception 'FAIL: the 10 pm run took a Read check-in during its quiz window (zone %)', current_setting('test.late_zone');
  end if;
end $$;

-- Photos due for deletion: 30 days after their challenge ends, or whose user is gone. The owner
-- adds a photo whose user is gone, and one of A's from a challenge that ended 29 days ago.
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at,
                               outcome, ended_on_day, ended_at)
  values ('00000000-0000-4000-8000-0000000000a3', 'cook', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now(),
          'finished', 28, now() - interval '29 days');
select set_config('test.recent', '00000000-0000-4000-8000-0000000000a3/'
  || (select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a3' and habit_id = 'cook') || '/28-1.jpg', true);
insert into storage.objects (bucket_id, name) values
  ('check-in-photos', '00000000-0000-4000-8000-0000000000e3/x/1-1.jpg'),
  ('check-in-photos', current_setting('test.recent'));

do $$
declare own text := '00000000-0000-4000-8000-0000000000a3/' || current_setting('test.challenge') || '/4-2.jpg';
begin
  if not exists (select 1 from public.expired_check_in_photos() p where p = '00000000-0000-4000-8000-0000000000e3/x/1-1.jpg') then
    raise exception 'FAIL: a photo whose user is gone isn''t due for deletion';
  end if;
  if exists (select 1 from public.expired_check_in_photos() p where p in (own, current_setting('test.recent'))) then
    raise exception 'FAIL: a photo is due for deletion while its challenge runs, or before its 30 days';
  end if;
  update public.challenges set outcome = 'finished', ended_on_day = 5, ended_at = now() - interval '31 days'
    where id = current_setting('test.challenge')::uuid;
  if not exists (select 1 from public.expired_check_in_photos() p where p = own) then
    raise exception 'FAIL: a photo 30 days past its challenge isn''t due for deletion';
  end if;

  -- The owner may clear a recorded outcome after restoring the day that ended it (T29); users still
  -- can't (challenges_rls.sql).
  update public.challenges set outcome = null, ended_on_day = null, ended_at = null where id = current_setting('test.challenge')::uuid;
end $$;

reset role;

-- Asking before check-ins go to Kept's AI (T54, 0036). E chose Don't allow; F was never asked. Both
-- challenges started 2 days ago (today is Day 3), with Day 1 pending and Day 2 flagged.
reset role;
select set_config('request.jwt.claims', '', true);
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e5', 'verify-e5@kept.test'),
  ('00000000-0000-4000-8000-0000000000f5', 'verify-f5@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000e5', 'ver_test_e5', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000f5', 'ver_test_f5', '1990-01-01', 'OR');
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  select id, 'workout', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now()
  from auth.users where id in ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000f5');
update public.challenges set start_date = (now() at time zone 'America/Los_Angeles')::date - 2
  where user_id in ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000f5');
insert into public.check_ins (challenge_id, day, status)
  select c.id, d.day, d.status from public.challenges c, (values (1, 'pending'), (2, 'flagged')) as d(day, status)
  where c.user_id in ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000f5');

-- The app can change only its own answer.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e5","role":"authenticated"}', true);
do $$
declare n int;
begin
  update public.profiles set ai_allowed = false where id = '00000000-0000-4000-8000-0000000000e5';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: E couldn''t record Don''t allow'; end if;
  update public.profiles set ai_allowed = true where id = '00000000-0000-4000-8000-0000000000f5';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: E answered for F'; end if;
end $$;

-- The AI job's run: nothing of E's or F's goes to the AI. E's ended days no friend approved are
-- misses, with a reason; F's, never asked, count as done (Kept's gap, never the challenger's).
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare
  e uuid := (select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000e5');
  f uuid := (select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000f5');
  n int;
begin
  select count(*) into n from public.ai_check_claim(e);
  if n <> 0 then raise exception 'FAIL: % of E''s check-ins went to the AI after Don''t allow', n; end if;
  select count(*) into n from public.ai_check_claim(f);
  if n <> 0 then raise exception 'FAIL: % of F''s check-ins went to the AI without asking', n; end if;
  select count(*) into n from public.check_ins
    where challenge_id = e and status = 'rejected' and ai_reason is not null and ai_verdict is null and ai_checked_at is not null;
  if n <> 2 then raise exception 'FAIL: % of E''s unchecked days are misses, expected 2', n; end if;
  select count(*) into n from public.check_ins where challenge_id = f and status = 'excused';
  if n <> 2 then raise exception 'FAIL: % of F''s unchecked days count as done, expected 2', n; end if;
end $$;

-- Nor at 10 pm: E's photo check-in for today, in a zone already past 10 pm, stays with friends.
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000e5', 'stretch', 28, 1000, 'aspca', 'card', current_setting('test.late_zone'), now());
update public.challenges set start_date = (now() at time zone time_zone)::date - 3
  where user_id = '00000000-0000-4000-8000-0000000000e5' and habit_id = 'stretch';
insert into public.check_ins (challenge_id, day, status)
  select id, 4, 'pending' from public.challenges where user_id = '00000000-0000-4000-8000-0000000000e5' and habit_id = 'stretch';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare late uuid := (select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000e5' and habit_id = 'stretch');
begin
  perform public.ai_check_claim(late);
  if (select status from public.check_ins where challenge_id = late) <> 'pending' then
    raise exception 'FAIL: the 10 pm run sent E''s check-in to the AI after Don''t allow (zone %)', current_setting('test.late_zone');
  end if;
end $$;

-- E can still appeal a missed day to a person.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e5","role":"authenticated"}', true);
do $$
declare n int;
begin
  update public.check_ins set status = 'appealed', appeal_note = 'My friend forgot to look.'
    where day = 1 and challenge_id = (select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000e5' and habit_id = 'workout');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: E couldn''t appeal a day missed without the AI'; end if;
end $$;
reset role;

-- A friend who reviewed a check-in can still delete their account (T84, 0048): the reviewer goes to
-- null and the check-in stays. Clearing it used to trip the change rules and undo the whole deletion.
select set_config('request.jwt.claims', '', true);
update public.check_ins set reviewer_id = '00000000-0000-4000-8000-0000000000b3', reviewed_at = now()
  where challenge_id = current_setting('test.challenge')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
select public.delete_account();
reset role;
select set_config('request.jwt.claims', '', true);
do $$
begin
  if exists (select 1 from auth.users where id = '00000000-0000-4000-8000-0000000000b3') then
    raise exception 'FAIL: a reviewer''s account wasn''t deleted';
  end if;
  if exists (select 1 from public.check_ins where challenge_id = current_setting('test.challenge')::uuid and reviewer_id is not null)
     or not exists (select 1 from public.check_ins where challenge_id = current_setting('test.challenge')::uuid) then
    raise exception 'FAIL: the reviewed check-ins didn''t stay, with no reviewer';
  end if;
end $$;

rollback;

select 'PASS: check-in statuses, the challenger''s photo, retake and resubmit rules, friends'' reviews (approve or ask for a new photo, never reject, only friends from before Day 1 who pledged), the private photo bucket, the AI job (only the service role, due check-ins, a run that died counts as done, Next day through the server, photo deletion), and asking before the AI checks (Don''t allow: a miss; never asked: done)' as result;
