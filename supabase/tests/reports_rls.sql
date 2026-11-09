-- Proves report and block (migration 0035, T53, SPEC-friends.md "Reports and blocks"): reports go
-- in from a profile, a check-in or a public challenge, the database fills in who was reported, and
-- nobody but the owner reads them; each report queues a push to the owner. A block ends the
-- friendship and hides the two people from each other: find_user(), person_preview(), Discover,
-- friend requests and pledges, both ways. A block from a public challenge stays anonymous. Unblock
-- restores nothing. The word filter refuses objectionable usernames and notes, and a report
-- outlives the reporter's account.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/reports_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A reports and blocks. B is A's friend with a check-in waiting; C is a stranger with a public
-- challenge; D has a pending request to A. A has a public challenge of their own.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a9', 'report-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b9', 'report-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000c9', 'report-c@kept.test'),
  ('00000000-0000-4000-8000-0000000000d9', 'report-d@kept.test');

insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a9', 'rp_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000b9', 'rp_test_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000c9', 'rp_test_c', '1990-01-01', 'TX'),
  ('00000000-0000-4000-8000-0000000000d9', 'rp_test_d', '1990-01-01', 'WA');

insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000b9', 'accepted', now() - interval '10 days'),
  ('00000000-0000-4000-8000-0000000000d9', '00000000-0000-4000-8000-0000000000a9', 'pending', null);

insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, is_public)
  values ('00000000-0000-4000-8000-0000000000b9', 'workout', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now(), false),
         ('00000000-0000-4000-8000-0000000000c9', 'read', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now(), true),
         ('00000000-0000-4000-8000-0000000000a9', 'journal', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now(), true);
update public.challenges set day_offset = 1 where user_id in ('00000000-0000-4000-8000-0000000000b9', '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000a9');
insert into public.check_ins (challenge_id, day, status)
  select id, 1, 'pending' from public.challenges where user_id = '00000000-0000-4000-8000-0000000000b9';

select set_config('test.b_check_in', (select ci.id::text from public.check_ins ci join public.challenges c on c.id = ci.challenge_id
                                       where c.user_id = '00000000-0000-4000-8000-0000000000b9'), true);
select set_config('test.c_challenge', (select id::text from public.challenges where user_id = '00000000-0000-4000-8000-0000000000c9'), true);
select set_config('test.a_challenge', (select id::text from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a9'), true);
delete from net.http_request_queue where url like '%/functions/v1/notify';

-- Privileges: reports are write-only for app users; blocks and owners are reached only through functions.
do $$
begin
  if has_table_privilege('anon', 'public.reports', 'select') or has_any_column_privilege('anon', 'public.reports', 'insert')
     or has_table_privilege('authenticated', 'public.reports', 'select') or has_any_column_privilege('authenticated', 'public.reports', 'update')
     or has_table_privilege('authenticated', 'public.reports', 'delete') then
    raise exception 'FAIL: app users can read or change reports';
  end if;
  if has_column_privilege('authenticated', 'public.reports', 'reporter_id', 'insert')
     or has_column_privilege('authenticated', 'public.reports', 'resolved_at', 'insert')
     or not has_column_privilege('authenticated', 'public.reports', 'reason', 'insert') then
    raise exception 'FAIL: the report columns an app user may send are wrong';
  end if;
  if has_table_privilege('authenticated', 'public.blocks', 'select') or has_any_column_privilege('authenticated', 'public.blocks', 'insert')
     or has_table_privilege('authenticated', 'public.blocks', 'delete') or has_table_privilege('authenticated', 'public.kept_owners', 'select') then
    raise exception 'FAIL: app users can touch blocks or owners directly';
  end if;
  if has_function_privilege('anon', 'public.block_user(uuid)', 'execute') or has_function_privilege('anon', 'public.my_blocks()', 'execute')
     or has_function_privilege('authenticated', 'public.blocked_between(uuid, uuid)', 'execute') then
    raise exception 'FAIL: anon can block, or anyone can ask who blocked whom';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);

-- As A: reports from a profile, a check-in and a public challenge; can't read them back.
do $$
declare
  n int;
begin
  insert into public.reports (reported_id, reason, note) values ('00000000-0000-4000-8000-0000000000b9', 'harassment', 'Keeps messaging me');
  insert into public.reports (check_in_id, reason) values (current_setting('test.b_check_in')::uuid, 'nudity');
  insert into public.reports (challenge_id, reason) values (current_setting('test.c_challenge')::uuid, 'spam');
  begin
    select count(*) into n from public.reports;
    raise exception 'FAIL: A read reports';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.reports (reported_id, reason) values ('00000000-0000-4000-8000-0000000000a9', 'spam');
    raise exception 'FAIL: A reported themselves';
  exception when raise_exception then
    if sqlerrm <> 'report_self' then raise; end if;
  end;
  begin
    insert into public.reports (reason) values ('spam');
    raise exception 'FAIL: a report with nothing reported was saved';
  exception when raise_exception then
    if sqlerrm <> 'report_no_target' then raise; end if;
  end;
  begin
    insert into public.reports (reported_id, reason) values ('00000000-0000-4000-8000-0000000000b9', 'boring');
    raise exception 'FAIL: a report with an unknown reason was saved';
  exception when check_violation then null;
  end;

  -- Before any block: A finds D, and C's public challenge is on A's Discover.
  select count(*) into n from public.find_user('rp_test_d');
  if n <> 1 then raise exception 'FAIL: A can''t find D before blocking'; end if;
  select count(*) into n from public.discover_challenges(current_setting('test.c_challenge')::uuid);
  if n <> 1 then raise exception 'FAIL: C''s public challenge isn''t on A''s Discover'; end if;

  -- Block D from their request; block C from their public challenge (anonymously); block B, a friend.
  perform public.block_user('00000000-0000-4000-8000-0000000000d9');
  perform public.block_challenger(current_setting('test.c_challenge')::uuid);
  perform public.block_user('00000000-0000-4000-8000-0000000000b9');
  begin
    perform public.block_user('00000000-0000-4000-8000-0000000000a9');
    raise exception 'FAIL: A blocked themselves';
  exception when raise_exception then
    if sqlerrm <> 'block_self' then raise; end if;
  end;

  -- The request and the friendship are gone; A no longer sees B's challenge or finds D.
  select count(*) into n from public.friendships;
  if n <> 0 then raise exception 'FAIL: % friendships survived A''s blocks', n; end if;
  select count(*) into n from public.challenges where user_id = '00000000-0000-4000-8000-0000000000b9';
  if n <> 0 then raise exception 'FAIL: A still reads B''s challenge after blocking'; end if;
  select count(*) into n from public.find_user('rp_test_d');
  if n <> 0 then raise exception 'FAIL: A still finds D after blocking'; end if;
  select count(*) into n from public.person_preview('rp_test_d');
  if n <> 0 then raise exception 'FAIL: A still previews D after blocking'; end if;
  select count(*) into n from public.discover_challenges(current_setting('test.c_challenge')::uuid);
  if n <> 0 then raise exception 'FAIL: C''s challenge is still on A''s Discover after blocking'; end if;

  -- Blocked accounts: D and B by name, C only as a public challenge's challenger.
  select count(*) into n from public.my_blocks() where username in ('rp_test_d', 'rp_test_b') and not anonymous;
  if n <> 2 then raise exception 'FAIL: my_blocks() lists % named blocks, expected 2', n; end if;
  select count(*) into n from public.my_blocks() where anonymous and username is null and avatar_path is null;
  if n <> 1 then raise exception 'FAIL: the block from Discover isn''t anonymous'; end if;
  if pg_get_function_result('public.my_blocks()'::regprocedure) ~* 'blocked_id|user_id' then
    raise exception 'FAIL: my_blocks() returns an id: %', pg_get_function_result('public.my_blocks()'::regprocedure);
  end if;
end $$;

-- As D, who A blocked: A can't be found, previewed or asked; D isn't told why.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d9","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.find_user('rp_test_a');
  if n <> 0 then raise exception 'FAIL: D finds A, who blocked them'; end if;
  select count(*) into n from public.person_preview('rp_test_a');
  if n <> 0 then raise exception 'FAIL: D previews A, who blocked them'; end if;
  begin
    insert into public.friendships (addressee_id) values ('00000000-0000-4000-8000-0000000000a9');
    raise exception 'FAIL: D asked A again after being blocked';
  exception when raise_exception then
    if sqlerrm <> 'friendship_not_allowed' then raise; end if;
  end;
  -- D doesn't learn of A's block, so has nothing to undo.
  select count(*) into n from public.my_blocks();
  if n <> 0 then raise exception 'FAIL: D sees % blocks, though D blocked no one', n; end if;
end $$;

-- As C, blocked from their own public challenge: A's public challenge is off C's Discover, and C can't pledge on it.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c9","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.discover_challenges(current_setting('test.a_challenge')::uuid);
  if n <> 0 then raise exception 'FAIL: A''s public challenge is on the Discover of C, whom A blocked'; end if;
  begin
    insert into public.pledges (challenge_id, amount_cents) values (current_setting('test.a_challenge')::uuid, 500);
    raise exception 'FAIL: C pledged on the challenge of A, who blocked them';
  exception when raise_exception then
    if sqlerrm <> 'pledge_not_allowed' then raise; end if;
  end;
end $$;

-- As B, a friend until A blocked them: can't review A's challenge or find A.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b9","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.find_user('rp_test_a');
  if n <> 0 then raise exception 'FAIL: B finds A after A blocked them'; end if;
  if public.can_review(current_setting('test.a_challenge')::uuid) then raise exception 'FAIL: B can still review A''s check-ins'; end if;
end $$;

-- A unblocks D: they can find each other again, but the request doesn't come back.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
do $$
declare n int;
begin
  perform public.unblock(b.id) from public.my_blocks() b where b.username = 'rp_test_d';
  select count(*) into n from public.find_user('rp_test_d');
  if n <> 1 then raise exception 'FAIL: A can''t find D after unblocking'; end if;
  select count(*) into n from public.friendships;
  if n <> 0 then raise exception 'FAIL: unblocking brought back a friendship or request'; end if;
  select count(*) into n from public.my_blocks();
  if n <> 2 then raise exception 'FAIL: % blocks left after unblocking D, expected 2', n; end if;

  -- The word filter: a username with a word on the list is refused; one merely containing it isn't.
  begin
    update public.profiles set username = 'shit.happens' where id = '00000000-0000-4000-8000-0000000000a9';
    raise exception 'FAIL: an objectionable username was saved';
  exception when check_violation then
    if sqlerrm <> 'text_objectionable' then raise; end if;
  end;
  update public.profiles set username = 'scunthorpe_fan' where id = '00000000-0000-4000-8000-0000000000a9';
end $$;

-- The owner's view: every report, with who was reported filled in by the database, and a push
-- queued to the owner for each.
reset role;
select set_config('request.jwt.claims', '', true);
do $$
declare got text;
begin
  select string_agg(reason || ' ' || right(reported_id::text, 2), ', ' order by reason) into got
    from public.reports where reporter_id = '00000000-0000-4000-8000-0000000000a9';
  if got is distinct from 'harassment b9, nudity b9, spam c9' then raise exception 'FAIL: reports saved as %', got; end if;
  if (select count(*) from net.http_request_queue
      where url like '%/functions/v1/notify' and convert_from(body, 'utf8')::jsonb ? 'report') <> 3 then
    raise exception 'FAIL: expected 3 report calls to notify';
  end if;
  -- Notes are filtered too: a flag note or an appeal note with a word on the list is refused.
  begin
    update public.check_ins set flag_note = 'what a bitch' where id = current_setting('test.b_check_in')::uuid;
    raise exception 'FAIL: an objectionable flag note was saved';
  exception when check_violation then null;
  end;
end $$;

-- A deletes their account: their blocks go, their reports stay (without the reporter) for the owner.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
select public.delete_account();
reset role;

do $$
begin
  if exists (select 1 from public.blocks where blocker_id = '00000000-0000-4000-8000-0000000000a9') then
    raise exception 'FAIL: delete_account() left A''s blocks behind';
  end if;
  if (select count(*) from public.reports where reporter_id is null and reported_id in ('00000000-0000-4000-8000-0000000000b9', '00000000-0000-4000-8000-0000000000c9')) <> 3 then
    raise exception 'FAIL: A''s reports didn''t outlive A''s account';
  end if;
end $$;

rollback;

select 'PASS: reports (write-only, targets filled in, owner pushed), blocks both ways (find, preview, Discover, requests, pledges, reviews), anonymous blocks, unblock, the word filter, and the cascade' as result;
