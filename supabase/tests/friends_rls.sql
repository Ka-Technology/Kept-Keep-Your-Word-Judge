-- Proves the friends module's privileges, RLS policies and functions (migrations 0009-0010 and
-- 0012, T22-T23, SPEC-friends.md): exact-username search that returns only id, username and photo;
-- requests that only the addressee can accept; self and duplicate requests refused; decline,
-- cancel and unfriend; friends (and only accepted friends) reading each other's challenges and
-- check-ins, until they unfriend; the cascade from delete_account(); and the preview before a
-- request (0034, T58: the month they joined and friends in common, nothing else).
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/friends_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a2', 'friends-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b2', 'friends-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000c2', 'friends-c@kept.test');

insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a2', 'fr_test_a', '1990-01-01', 'NY'),
  ('00000000-0000-4000-8000-0000000000b2', 'fr_test_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000c2', 'fr_test_c', '1990-01-01', 'TX');

-- B's challenge with one check-in, created as the owner would (no user JWT), for the friend reads.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000b2', 'read', 28, 2000, 'msf', 'card', 'America/Los_Angeles', now());
insert into public.check_ins (challenge_id, day, status)
  select id, 1, 'approved' from public.challenges where user_id = '00000000-0000-4000-8000-0000000000b2';

-- Privileges, and what the functions can return
do $$
begin
  if has_table_privilege('anon', 'public.friendships', 'select') or has_any_column_privilege('anon', 'public.friendships', 'insert')
     or has_table_privilege('anon', 'public.friendships', 'delete') or has_any_column_privilege('anon', 'public.friendships', 'update') then
    raise exception 'FAIL: anon can touch friendships';
  end if;
  if has_column_privilege('authenticated', 'public.friendships', 'requester_id', 'insert')
     or has_column_privilege('authenticated', 'public.friendships', 'status', 'insert')
     or has_column_privilege('authenticated', 'public.friendships', 'accepted_at', 'insert')
     or has_column_privilege('authenticated', 'public.friendships', 'requester_id', 'update')
     or has_column_privilege('authenticated', 'public.friendships', 'addressee_id', 'update')
     or has_column_privilege('authenticated', 'public.friendships', 'accepted_at', 'update') then
    raise exception 'FAIL: authenticated can set a friendship column it must not';
  end if;
  if not has_column_privilege('authenticated', 'public.friendships', 'addressee_id', 'insert')
     or not has_column_privilege('authenticated', 'public.friendships', 'status', 'update')
     or not has_table_privilege('authenticated', 'public.friendships', 'delete') then
    raise exception 'FAIL: authenticated cannot request, accept or delete';
  end if;
  if has_function_privilege('anon', 'public.find_user(text)', 'execute') or has_function_privilege('anon', 'public.my_friends()', 'execute') then
    raise exception 'FAIL: anon can call find_user() or my_friends()';
  end if;
  if not has_function_privilege('authenticated', 'public.find_user(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.my_friends()', 'execute') then
    raise exception 'FAIL: authenticated cannot call find_user() or my_friends()';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendships') then
    raise exception 'FAIL: friendships is not in the Realtime publication (the red dot on Me)';
  end if;
  -- Email, date of birth and state never leave the database through these functions.
  if pg_get_function_result('public.find_user(text)'::regprocedure) <> 'TABLE(id uuid, username text, avatar_path text)' then
    raise exception 'FAIL: find_user() returns %', pg_get_function_result('public.find_user(text)'::regprocedure);
  end if;
  if pg_get_function_result('public.my_friends()'::regprocedure) ~* '(email|birth|state_code)' then
    raise exception 'FAIL: my_friends() returns %', pg_get_function_result('public.my_friends()'::regprocedure);
  end if;
end $$;

-- As user A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

do $$
declare
  n int;
  found_id uuid;
begin
  -- Exact username only: no partial, prefix or differently cased match.
  select id into found_id from public.find_user('fr_test_b');
  if found_id is distinct from '00000000-0000-4000-8000-0000000000b2' then raise exception 'FAIL: find_user missed an exact username'; end if;
  select count(*) into n from public.find_user('fr_test');
  if n <> 0 then raise exception 'FAIL: find_user matched a partial username'; end if;
  select count(*) into n from public.find_user('FR_TEST_B');
  if n <> 0 then raise exception 'FAIL: find_user ignored case'; end if;
  -- The profiles select policy is unchanged: A still reads only their own row.
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FAIL: A reads % profiles, expected 1', n; end if;

  -- A asks B.
  insert into public.friendships (addressee_id) values ('00000000-0000-4000-8000-0000000000b2');
  select count(*) into n from public.friendships
    where requester_id = '00000000-0000-4000-8000-0000000000a2' and status = 'pending' and accepted_at is null;
  if n <> 1 then raise exception 'FAIL: A''s request was not saved as pending from A'; end if;

  -- Not to yourself.
  begin
    insert into public.friendships (addressee_id) values ('00000000-0000-4000-8000-0000000000a2');
    raise exception 'FAIL: A sent a request to themselves';
  exception when check_violation then null;
  end;
  -- Not twice.
  begin
    insert into public.friendships (addressee_id) values ('00000000-0000-4000-8000-0000000000b2');
    raise exception 'FAIL: A sent B a second request';
  exception when unique_violation then null;
  end;
  -- Not with a status.
  begin
    insert into public.friendships (addressee_id, status) values ('00000000-0000-4000-8000-0000000000c2', 'accepted');
    raise exception 'FAIL: A created an accepted friendship';
  exception when insufficient_privilege then null;
  end;

  -- A pending request gives no access to B's challenges.
  select count(*) into n from public.challenges where user_id = '00000000-0000-4000-8000-0000000000b2';
  if n <> 0 then raise exception 'FAIL: A read B''s challenge before B accepted'; end if;

  -- The requester can't accept their own request.
  update public.friendships set status = 'accepted' where addressee_id = '00000000-0000-4000-8000-0000000000b2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: the requester accepted their own request'; end if;

  select count(*) into n from public.my_friends() where username = 'fr_test_b' and status = 'pending' and direction = 'outgoing';
  if n <> 1 then raise exception 'FAIL: A''s my_friends() lacks the outgoing request to B'; end if;
end $$;

-- As user B, who was asked
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);

do $$
declare n int;
begin
  -- B can't ask back while A's request waits.
  begin
    insert into public.friendships (addressee_id) values ('00000000-0000-4000-8000-0000000000a2');
    raise exception 'FAIL: B sent A a request in the other direction';
  exception when unique_violation then null;
  end;

  select count(*) into n from public.my_friends() where username = 'fr_test_a' and status = 'pending' and direction = 'incoming';
  if n <> 1 then raise exception 'FAIL: B''s my_friends() lacks the incoming request from A'; end if;

  update public.friendships set status = 'accepted' where requester_id = '00000000-0000-4000-8000-0000000000a2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: B could not accept'; end if;
  if (select accepted_at from public.friendships where requester_id = '00000000-0000-4000-8000-0000000000a2') is null then
    raise exception 'FAIL: accepting did not set accepted_at';
  end if;

  -- Accepted is final (only pending -> accepted).
  begin
    update public.friendships set status = 'pending' where requester_id = '00000000-0000-4000-8000-0000000000a2';
    raise exception 'FAIL: an accepted friendship went back to pending';
  exception when check_violation then null;
  end;

  select count(*) into n from public.my_friends() where username = 'fr_test_a' and status = 'accepted';
  if n <> 1 then raise exception 'FAIL: B''s my_friends() lacks A as a friend'; end if;
end $$;

-- A, now B's friend, reads B's challenge and check-ins (T23), but can't change them.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.challenges where user_id = '00000000-0000-4000-8000-0000000000b2';
  if n <> 1 then raise exception 'FAIL: A reads % of B''s challenges, expected 1', n; end if;
  select count(*) into n from public.check_ins ci join public.challenges c on c.id = ci.challenge_id where c.user_id = '00000000-0000-4000-8000-0000000000b2';
  if n <> 1 then raise exception 'FAIL: A reads % of B''s check-ins, expected 1', n; end if;
  update public.challenges set outcome = 'not_finished', ended_on_day = 1, ended_at = now() where user_id = '00000000-0000-4000-8000-0000000000b2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: A changed B''s challenge'; end if;
end $$;

-- As user C, who has nothing to do with A and B
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.friendships;
  if n <> 0 then raise exception 'FAIL: C reads % friendships, expected 0', n; end if;
  select count(*) into n from public.challenges;
  if n <> 0 then raise exception 'FAIL: C, not a friend, reads % challenges', n; end if;
  select count(*) into n from public.check_ins;
  if n <> 0 then raise exception 'FAIL: C, not a friend, reads % check-ins', n; end if;
  select count(*) into n from public.my_friends();
  if n <> 0 then raise exception 'FAIL: C''s my_friends() returns % rows, expected 0', n; end if;
  delete from public.friendships;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: C deleted someone else''s friendship'; end if;
  update public.friendships set status = 'accepted';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: C updated someone else''s friendship'; end if;

  -- C asks A (declined below) and B (cancelled below).
  insert into public.friendships (addressee_id) values ('00000000-0000-4000-8000-0000000000a2'), ('00000000-0000-4000-8000-0000000000b2');
end $$;

-- A declines C; A unfriends B
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

do $$
declare n int;
begin
  delete from public.friendships where requester_id = '00000000-0000-4000-8000-0000000000c2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A could not decline C'; end if;
  delete from public.friendships where '00000000-0000-4000-8000-0000000000b2' in (requester_id, addressee_id);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A could not unfriend B'; end if;
  select count(*) into n from public.my_friends();
  if n <> 0 then raise exception 'FAIL: A still has % friendships', n; end if;
  -- Unfriending takes B's challenges and check-ins away at once.
  select count(*) into n from public.challenges where user_id = '00000000-0000-4000-8000-0000000000b2';
  if n <> 0 then raise exception 'FAIL: A still reads B''s challenge after unfriending'; end if;
  select count(*) into n from public.check_ins;
  if n <> 0 then raise exception 'FAIL: A still reads B''s check-ins after unfriending'; end if;
end $$;

-- C cancels their request to B, then asks again and deletes their account
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);

do $$
declare n int;
begin
  delete from public.friendships where addressee_id = '00000000-0000-4000-8000-0000000000b2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: C could not cancel their request'; end if;
  -- A declined request can be sent again.
  insert into public.friendships (addressee_id) values ('00000000-0000-4000-8000-0000000000a2');
end $$;

select public.delete_account();

reset role;

do $$
begin
  if exists (select 1 from public.friendships where '00000000-0000-4000-8000-0000000000c2' in (requester_id, addressee_id)) then
    raise exception 'FAIL: delete_account() left C''s friendships behind';
  end if;
end $$;

-- The preview before a request (T58, person_preview()). P looks up T. M1-M4 are friends of both;
-- M5 is P's friend but only asked T (pending); X is T's friend only. T joined in August 2026.
insert into auth.users (id, email)
  select ('00000000-0000-4000-8000-0000000001' || s)::uuid, 'preview-' || s || '@kept.test'
  from unnest(array['a0', 'b0', 'c1', 'c2', 'c3', 'c4', 'c5', 'd0']) as s;
insert into public.profiles (id, username, date_of_birth, state_code, created_at)
  select ('00000000-0000-4000-8000-0000000001' || s)::uuid, name, '1990-01-01', 'OR', joined::timestamptz
  from (values ('a0', 'pv_p', '2026-09-01'), ('b0', 'pv_t', '2026-08-15 23:30:00+00'),
               ('c1', 'pv_m1', '2026-09-01'), ('c2', 'pv_m2', '2026-09-01'), ('c3', 'pv_m3', '2026-09-01'),
               ('c4', 'pv_m4', '2026-09-01'), ('c5', 'pv_m5', '2026-09-01'), ('d0', 'pv_x', '2026-09-01')) as v(s, name, joined);
insert into public.friendships (requester_id, addressee_id, status, accepted_at)
  select ('00000000-0000-4000-8000-0000000001' || a)::uuid, ('00000000-0000-4000-8000-0000000001' || b)::uuid, st,
         case when st = 'accepted' then now() end
  from (values ('a0', 'c1', 'accepted'), ('a0', 'c2', 'accepted'), ('a0', 'c3', 'accepted'), ('a0', 'c4', 'accepted'), ('a0', 'c5', 'accepted'),
               ('b0', 'c1', 'accepted'), ('b0', 'c2', 'accepted'), ('b0', 'c3', 'accepted'), ('b0', 'c4', 'accepted'), ('c5', 'b0', 'pending'),
               ('b0', 'd0', 'accepted')) as v(a, b, st);

do $$
begin
  if has_function_privilege('anon', 'public.person_preview(text)', 'execute') then
    raise exception 'FAIL: anon can call person_preview()';
  end if;
  -- Only these fields: never email, date of birth, state, challenges or a completion rate.
  if pg_get_function_result('public.person_preview(text)'::regprocedure)
     <> 'TABLE(id uuid, username text, avatar_path text, member_since date, mutual_count integer, mutual_names text[])' then
    raise exception 'FAIL: person_preview() returns %', pg_get_function_result('public.person_preview(text)'::regprocedure);
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001a0","role":"authenticated"}', true);

do $$
declare
  r record;
  n int;
begin
  select * into r from public.person_preview('pv_t');
  if r.id is distinct from '00000000-0000-4000-8000-0000000001b0' or r.username <> 'pv_t' then
    raise exception 'FAIL: person_preview() didn''t find pv_t';
  end if;
  -- The month they joined, nothing finer.
  if r.member_since <> '2026-08-01' then raise exception 'FAIL: member_since is %, expected 2026-08-01', r.member_since; end if;
  -- Friends of both, counted in full and named up to 3: not M5 (only asked T), not X (T's friend only).
  if r.mutual_count <> 4 then raise exception 'FAIL: % friends in common, expected 4', r.mutual_count; end if;
  if r.mutual_names <> array['pv_m1', 'pv_m2', 'pv_m3'] then raise exception 'FAIL: named %', r.mutual_names; end if;
  -- None in common: an empty list, not null.
  select * into r from public.person_preview('pv_x');
  if r.mutual_count <> 0 or r.mutual_names <> '{}' then raise exception 'FAIL: pv_x has % in common: %', r.mutual_count, r.mutual_names; end if;
  -- Exact username only.
  select count(*) into n from public.person_preview('pv_');
  if n <> 0 then raise exception 'FAIL: person_preview() matched a partial username'; end if;
  select count(*) into n from public.person_preview('PV_T');
  if n <> 0 then raise exception 'FAIL: person_preview() ignored case'; end if;
end $$;

-- Search as you type and People you may know (0041, owner 2026-10-03). Still as P, with the same
-- people: T is a friend of P's friends M1-M4; X is T's friend only; M5 is already P's friend.
do $$
declare
  r record;
  n int;
begin
  if has_function_privilege('anon', 'public.search_users(text)', 'execute') or has_function_privilege('anon', 'public.suggested_friends()', 'execute') then
    raise exception 'FAIL: anon can call search_users() or suggested_friends()';
  end if;
  -- Only these fields: never email, date of birth or state.
  if pg_get_function_result('public.search_users(text)'::regprocedure) <> 'TABLE(id uuid, username text, avatar_path text)' then
    raise exception 'FAIL: search_users() returns %', pg_get_function_result('public.search_users(text)'::regprocedure);
  end if;
  if pg_get_function_result('public.suggested_friends()'::regprocedure) <> 'TABLE(id uuid, username text, avatar_path text, mutual_count integer)' then
    raise exception 'FAIL: suggested_friends() returns %', pg_get_function_result('public.suggested_friends()'::regprocedure);
  end if;

  -- Usernames that start with the letters, in any case.
  select count(*) into n from public.search_users('pv_m');
  if n <> 5 then raise exception 'FAIL: search_users(pv_m) found %, expected 5', n; end if;
  select count(*) into n from public.search_users('PV_M');
  if n <> 5 then raise exception 'FAIL: search_users(PV_M) found %, expected 5', n; end if;
  -- The start only, 2 letters or more, '_' as a plain letter, and never P themself.
  select count(*) into n from public.search_users('m1');
  if n <> 0 then raise exception 'FAIL: search_users matched the middle of a username'; end if;
  select count(*) into n from public.search_users('p');
  if n <> 0 then raise exception 'FAIL: search_users answered a single letter'; end if;
  select count(*) into n from public.search_users('p_');
  if n <> 0 then raise exception 'FAIL: search_users read _ as a wildcard'; end if;
  if exists (select 1 from public.search_users('pv_p')) then raise exception 'FAIL: search_users returned the caller'; end if;

  -- T, through 4 friends in common; not X (none in common) and not M1-M5 (already friends).
  select count(*) into n from public.suggested_friends();
  if n <> 1 then raise exception 'FAIL: % suggestions, expected 1', n; end if;
  select * into r from public.suggested_friends();
  if r.username <> 'pv_t' or r.mutual_count <> 4 then raise exception 'FAIL: suggested % with %', r.username, r.mutual_count; end if;
  -- Asked already: no longer suggested. Cancelled: suggested again.
  insert into public.friendships (addressee_id) values ('00000000-0000-4000-8000-0000000001b0');
  if exists (select 1 from public.suggested_friends()) then raise exception 'FAIL: suggested someone P already asked'; end if;
  delete from public.friendships where addressee_id = '00000000-0000-4000-8000-0000000001b0';
  if not exists (select 1 from public.suggested_friends()) then raise exception 'FAIL: a cancelled request hid the suggestion'; end if;
  -- Blocked: neither searchable nor suggested.
  perform public.block_user('00000000-0000-4000-8000-0000000001b0');
  if exists (select 1 from public.suggested_friends()) then raise exception 'FAIL: suggested a blocked person'; end if;
  if exists (select 1 from public.search_users('pv_t')) then raise exception 'FAIL: search_users returned a blocked person'; end if;
end $$;

reset role;

rollback;

select 'PASS: friendships privileges, RLS, find_user(), my_friends(), requests, accept, decline, unfriend, friends'' challenge reads, cascade, person_preview(), search_users() and suggested_friends()' as result;
