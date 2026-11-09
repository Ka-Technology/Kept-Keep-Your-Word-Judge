-- Proves free trackers (migration 0040, SPEC-trackers.md): private to their user, even from friends;
-- Day 1 set by the database; names through the word filter; a day logged only for today or
-- yesterday, from the first day, while it isn't archived (for everyone: the owner can't log an old
-- day either), and undone only in that window; nothing but the archive time changes; and an
-- account's trackers go with it.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/trackers_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000aa', 'trackers-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000ba', 'trackers-b@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000aa', 'tr_test_a', '1990-01-01', 'NY'),
  ('00000000-0000-4000-8000-0000000000ba', 'tr_test_b', '1990-01-01', 'CA');
-- Friends, to show a friend still sees nothing.
insert into public.friendships (requester_id, addressee_id, status, accepted_at)
  values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000ba', 'accepted', now());

do $$
begin
  if has_table_privilege('anon', 'public.trackers', 'select') or has_table_privilege('anon', 'public.tracker_days', 'select') then
    raise exception 'FAIL: anon can read trackers';
  end if;
  if has_column_privilege('authenticated', 'public.trackers', 'start_date', 'insert')
     or has_column_privilege('authenticated', 'public.trackers', 'user_id', 'insert')
     or has_column_privilege('authenticated', 'public.trackers', 'name', 'update')
     or has_table_privilege('authenticated', 'public.trackers', 'delete') then
    raise exception 'FAIL: authenticated can set a tracker column it must not';
  end if;
end $$;

-- As A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);

do $$
declare
  t public.trackers;
  today date := (now() at time zone 'America/New_York')::date;
  n int;
  msg text;
begin
  insert into public.trackers (name, goal_days, shields, time_zone) values ('  Floss  ', null, 1, 'America/New_York') returning * into t;
  if t.user_id <> '00000000-0000-4000-8000-0000000000aa' or t.start_date <> today or t.name <> 'Floss' then
    raise exception 'FAIL: the tracker isn''t A''s, starting today, with a trimmed name';
  end if;
  perform set_config('test.tracker', t.id::text, true);

  begin
    insert into public.trackers (name, time_zone) values ('fuck sugar', 'America/New_York');
    raise exception 'FAIL: an offensive tracker name was accepted';
  exception when check_violation then get stacked diagnostics msg = message_text;
    if msg <> 'text_objectionable' then raise exception 'FAIL: wrong name error: %', msg; end if;
  end;
  begin
    insert into public.trackers (name, shields, time_zone) values ('Read', 4, 'America/New_York');
    raise exception 'FAIL: 4 shields were accepted';
  exception when check_violation then null;
  end;

  -- Today, once; yesterday is before Day 1 here, and tomorrow is never allowed.
  insert into public.tracker_days (tracker_id, day) values (t.id, today);
  begin
    insert into public.tracker_days (tracker_id, day) values (t.id, today);
    raise exception 'FAIL: today was logged twice';
  exception when unique_violation then null;
  end;
  begin
    insert into public.tracker_days (tracker_id, day) values (t.id, today + 1);
    raise exception 'FAIL: tomorrow was logged';
  exception when check_violation then null;
  end;
  begin
    insert into public.tracker_days (tracker_id, day) values (t.id, today - 1);
    raise exception 'FAIL: a day before the tracker began was logged';
  exception when check_violation then null;
  end;

  -- Undo today's mis-tap, then log it again.
  delete from public.tracker_days where tracker_id = t.id and day = today;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A couldn''t undo today'; end if;
  insert into public.tracker_days (tracker_id, day) values (t.id, today);

  -- Archived: no more days.
  update public.trackers set archived_at = now() where id = t.id;
  delete from public.tracker_days where tracker_id = t.id;
  begin
    insert into public.tracker_days (tracker_id, day) values (t.id, today);
    raise exception 'FAIL: a day was logged on an archived tracker';
  exception when check_violation then null;
  end;
end $$;

-- As the owner: the tracker began 10 days ago, and runs again (unarchived) for the rest of the test.
reset role;
select set_config('request.jwt.claims', '', true);
update public.trackers set start_date = start_date - 10, archived_at = null where id = current_setting('test.tracker')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);

-- Now that Day 1 is past, yesterday can be marked.
insert into public.tracker_days (tracker_id, day)
  values (current_setting('test.tracker')::uuid, (now() at time zone 'America/New_York')::date - 1);

-- The owner moves that day back 5 days (the trigger checks only new days, for everyone), so it's too
-- old for A to undo.
reset role;
select set_config('request.jwt.claims', '', true);
update public.tracker_days set day = day - 5 where tracker_id = current_setting('test.tracker')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);

do $$
declare
  n int;
begin
  delete from public.tracker_days where tracker_id = current_setting('test.tracker')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a day older than yesterday was undone'; end if;
end $$;

-- As B, A's friend: nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000ba","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.trackers) or exists (select 1 from public.tracker_days) then
    raise exception 'FAIL: a friend reads A''s trackers';
  end if;
  begin
    insert into public.tracker_days (tracker_id, day) values (current_setting('test.tracker')::uuid, (now() at time zone 'America/New_York')::date);
    raise exception 'FAIL: B logged a day on A''s tracker';
  exception when check_violation or insufficient_privilege then null;
  end;
end $$;

-- A deletes their account; the trackers go with it.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);
select public.delete_account();
reset role;
select set_config('request.jwt.claims', '', true);
do $$
begin
  if exists (select 1 from public.trackers where user_id = '00000000-0000-4000-8000-0000000000aa') then
    raise exception 'FAIL: delete_account() left trackers behind';
  end if;
end $$;

rollback;

select 'PASS: trackers private, logged only today or yesterday, word-filtered, archived, and deleted with the account' as result;
