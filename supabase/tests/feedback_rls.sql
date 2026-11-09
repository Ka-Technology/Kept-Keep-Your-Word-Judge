-- Proves Send feedback (migration 0053, T158, SPEC-app-shell.md "Feedback"): app users can send
-- feedback as themselves and never read it back; the kinds and the length are checked; at most 5 an
-- hour; a photo must be in the sender's own folder; each one queues a call to notify (the owner's
-- push and email); and feedback outlives the sender's account, without them.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/feedback_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000af', 'feedback-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000bf', 'feedback-b@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000af', 'fb_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000bf', 'fb_test_b', '1990-01-01', 'CA');
delete from net.http_request_queue where url like '%/functions/v1/notify';

-- Privileges: write-only for app users, and only the sender's columns.
do $$
begin
  if has_table_privilege('anon', 'public.feedback', 'select') or has_any_column_privilege('anon', 'public.feedback', 'insert')
     or has_table_privilege('authenticated', 'public.feedback', 'select') or has_any_column_privilege('authenticated', 'public.feedback', 'update')
     or has_table_privilege('authenticated', 'public.feedback', 'delete') then
    raise exception 'FAIL: app users can read or change feedback';
  end if;
  if has_column_privilege('authenticated', 'public.feedback', 'user_id', 'insert')
     or has_column_privilege('authenticated', 'public.feedback', 'handled_at', 'insert')
     or has_column_privilege('authenticated', 'public.feedback', 'created_at', 'insert')
     or not has_column_privilege('authenticated', 'public.feedback', 'message', 'insert') then
    raise exception 'FAIL: the feedback columns an app user may send are wrong';
  end if;
  if has_function_privilege('authenticated', 'public.feedback_notify()', 'execute')
     or has_function_privilege('authenticated', 'public.feedback_before_insert()', 'execute') then
    raise exception 'FAIL: app users can call feedback''s trigger functions';
  end if;
  if (select public from storage.buckets where id = 'feedback') is distinct from false then
    raise exception 'FAIL: the feedback bucket is missing or public';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000af","role":"authenticated"}', true);

-- As A: sends feedback, can't read it back, and the checks hold.
do $$
declare
  n int;
begin
  insert into public.feedback (kind, message, app_version, os, os_version) values ('habit', 'Please add flossing', '1.0.0', 'ios', '26.1');
  insert into public.feedback (kind, message, photo_path) values ('bug', 'The camera froze', '00000000-0000-4000-8000-0000000000af/one.jpg');
  begin
    select count(*) into n from public.feedback;
    raise exception 'FAIL: A read feedback';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.feedback (kind, message) values ('rant', 'Hello');
    raise exception 'FAIL: feedback of an unknown kind was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.feedback (kind, message) values ('idea', '   ');
    raise exception 'FAIL: blank feedback was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.feedback (kind, message) values ('idea', repeat('a', 2001));
    raise exception 'FAIL: feedback over 2000 characters was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.feedback (kind, message, photo_path) values ('bug', 'Look', '00000000-0000-4000-8000-0000000000bf/theirs.jpg');
    raise exception 'FAIL: feedback pointed at someone else''s photo';
  exception when check_violation then
    if sqlerrm <> 'feedback_photo_not_yours' then raise; end if;
  end;
  begin
    insert into public.feedback (user_id, kind, message) values ('00000000-0000-4000-8000-0000000000bf', 'other', 'As B');
    raise exception 'FAIL: A sent feedback as B';
  exception when insufficient_privilege then null;
  end;
  -- Three more make five in the hour; the sixth is refused.
  insert into public.feedback (kind, message) values ('idea', 'Three'), ('idea', 'Four'), ('other', 'Five');
  begin
    insert into public.feedback (kind, message) values ('other', 'Six');
    raise exception 'FAIL: a sixth feedback in an hour was saved';
  exception when check_violation then
    if sqlerrm <> 'feedback_rate_limited' then raise; end if;
  end;
end $$;

-- The owner's view: A's five, with the time set by the database, and a call to notify for each.
reset role;
select set_config('request.jwt.claims', '', true);
do $$
begin
  if (select count(*) from public.feedback where user_id = '00000000-0000-4000-8000-0000000000af') <> 5 then
    raise exception 'FAIL: expected A''s 5 feedback rows';
  end if;
  if exists (select 1 from public.feedback where user_id = '00000000-0000-4000-8000-0000000000af' and handled_at is not null) then
    raise exception 'FAIL: new feedback arrived handled';
  end if;
  if (select count(*) from net.http_request_queue
      where url like '%/functions/v1/notify' and convert_from(body, 'utf8')::jsonb ? 'feedback') <> 5 then
    raise exception 'FAIL: expected 5 feedback calls to notify';
  end if;
end $$;

-- A deletes their account: the feedback stays for the owner, without A.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000af","role":"authenticated"}', true);
select public.delete_account();
reset role;

do $$
begin
  if (select count(*) from public.feedback where user_id is null and message in ('Please add flossing', 'The camera froze')) <> 2 then
    raise exception 'FAIL: feedback didn''t outlive the sender''s account';
  end if;
end $$;

rollback;
select 'PASS: feedback is write-only, checked, limited, pushed and emailed, and outlives the account' as result;
