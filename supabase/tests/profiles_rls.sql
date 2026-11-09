-- Proves the profiles table's privileges, RLS policies, constraints, real names (0050), Settings edits, profile photos
-- (the avatars bucket), the sign-up username check (username_available, 0011) and delete_account().
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/profiles_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'rls-a@kept.test'),
  ('00000000-0000-4000-8000-00000000000b', 'rls-b@kept.test'),
  ('00000000-0000-4000-8000-00000000000c', 'rls-c@kept.test');

insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-00000000000a', 'rls_test_a', '1990-01-01', 'NY'),
  ('00000000-0000-4000-8000-00000000000b', 'rls_test_b', '1990-01-01', 'CA');

-- Privileges
do $$
begin
  if has_table_privilege('anon', 'public.profiles', 'select') then
    raise exception 'FAIL: anon can select profiles';
  end if;
  if has_any_column_privilege('anon', 'public.profiles', 'update') then
    raise exception 'FAIL: anon can update profiles';
  end if;
  if has_table_privilege('authenticated', 'public.profiles', 'delete') then
    raise exception 'FAIL: authenticated can delete profiles directly';
  end if;
  -- Settings (T39): only username and state can change.
  if not has_column_privilege('authenticated', 'public.profiles', 'username', 'update')
     or not has_column_privilege('authenticated', 'public.profiles', 'state_code', 'update')
     or not has_column_privilege('authenticated', 'public.profiles', 'avatar_path', 'update')
     or not has_column_privilege('authenticated', 'public.profiles', 'first_name', 'update')
     or not has_column_privilege('authenticated', 'public.profiles', 'last_name', 'update') then
    raise exception 'FAIL: authenticated cannot update username, state, photo and name';
  end if;
  if not exists (select 1 from storage.buckets where id = 'avatars' and public) then
    raise exception 'FAIL: the public avatars bucket is missing';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'date_of_birth', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'id', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'created_at', 'update') then
    raise exception 'FAIL: authenticated can update date_of_birth, id or created_at';
  end if;
  if has_function_privilege('anon', 'public.delete_account()', 'execute') then
    raise exception 'FAIL: anon can execute delete_account()';
  end if;
  if not has_function_privilege('authenticated', 'public.delete_account()', 'execute') then
    raise exception 'FAIL: authenticated cannot execute delete_account()';
  end if;
end $$;

-- Signed out: sign-up asks whether a username is free, and learns nothing else.
set local role anon;

do $$
begin
  if public.username_available('rls_test_b') then raise exception 'FAIL: a taken username counts as free'; end if;
  if not public.username_available('rls_test_free') then raise exception 'FAIL: a free username counts as taken'; end if;
  if public.username_available('rls_test_a') is distinct from false then raise exception 'FAIL: username_available is not a plain yes or no'; end if;
  begin
    perform 1 from public.profiles;
    raise exception 'FAIL: anon can read profiles';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- As user A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FAIL: A sees % profile rows, expected 1', n; end if;

  -- B's row is hidden from A, so A's update touches nothing.
  update public.profiles set state_code = 'TX' where id = '00000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: A updated B''s profile'; end if;

  -- A can change their own username and state (Settings, T39)...
  update public.profiles set username = 'rls_test_a2', state_code = 'TX'
    where id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A could not change their own username and state'; end if;

  -- ...and their name, which accounts from before add here (T145, 0050)...
  update public.profiles set first_name = 'Alex', last_name = 'Test'
    where id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A could not add their name'; end if;
  update public.profiles set first_name = 'Mallory' where id = '00000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: A changed B''s name'; end if;
  begin
    update public.profiles set last_name = '' where id = '00000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: A emptied their last name';
  exception when check_violation then null;
  end;

  -- ...but not their date of birth.
  begin
    update public.profiles set date_of_birth = '2000-01-01' where id = '00000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: A changed their date of birth';
  exception when insufficient_privilege then null;
  end;

  -- The sign-up rules still apply to changes.
  begin
    update public.profiles set username = 'Bad Name' where id = '00000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: A changed to an invalid username';
  exception when check_violation then null;
  end;

  begin
    update public.profiles set username = 'rls_test_b' where id = '00000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: A took B''s username';
  exception when unique_violation then null;
  end;

  begin
    update public.profiles set state_code = 'XX' where id = '00000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: A changed to an invalid state code';
  exception when check_violation then null;
  end;

  begin
    insert into public.profiles (id, username, date_of_birth, state_code)
      values ('00000000-0000-4000-8000-00000000000c', 'rls_spoof', '1990-01-01', 'NY');
    raise exception 'FAIL: A inserted a profile for another user';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Profile photos, still as A: only your own folder (T47).
do $$
declare n int;
begin
  update public.profiles set avatar_path = '00000000-0000-4000-8000-00000000000a/1.jpg'
    where id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A could not set their own photo'; end if;

  begin
    update public.profiles set avatar_path = '00000000-0000-4000-8000-00000000000b/1.jpg'
      where id = '00000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: A pointed their photo at another user''s folder';
  exception when check_violation then null;
  end;

  update public.profiles set avatar_path = '00000000-0000-4000-8000-00000000000b/1.jpg'
    where id = '00000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: A changed B''s photo'; end if;

  insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-4000-8000-00000000000a/1.jpg');
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-4000-8000-00000000000b/1.jpg');
    raise exception 'FAIL: A uploaded into another user''s photo folder';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from storage.objects where bucket_id = 'avatars') <> 1 then
    raise exception 'FAIL: A sees photo files outside their own folder';
  end if;
end $$;

-- As user C, who has no profile yet
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);

do $$
declare n int;
begin
  -- A new profile needs a real name (T145, 0050), trimmed, 1 to 50 characters each.
  begin
    insert into public.profiles (id, username, date_of_birth, state_code)
      values ('00000000-0000-4000-8000-00000000000c', 'rls_test_c', '1990-01-01', 'NY');
    raise exception 'FAIL: a profile without a name was accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.profiles (id, username, date_of_birth, state_code, first_name, last_name)
      values ('00000000-0000-4000-8000-00000000000c', 'rls_test_c', '1990-01-01', 'NY', 'Casey', null);
    raise exception 'FAIL: a profile without a last name was accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.profiles (id, username, date_of_birth, state_code, first_name, last_name)
      values ('00000000-0000-4000-8000-00000000000c', 'rls_test_c', '1990-01-01', 'NY', ' Casey', 'Test');
    raise exception 'FAIL: an untrimmed name was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.profiles (id, username, date_of_birth, state_code, first_name, last_name)
      values ('00000000-0000-4000-8000-00000000000c', 'rls_test_c', '1990-01-01', 'NY', 'Casey', repeat('x', 51));
    raise exception 'FAIL: a 51-character name was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.profiles (id, username, date_of_birth, state_code, first_name, last_name)
      values ('00000000-0000-4000-8000-00000000000c', 'rls_test_c', (current_date - interval '18 years')::date + 1, 'NY', 'Casey', 'Test');
    raise exception 'FAIL: a DOB one day short of 18 was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.profiles (id, username, date_of_birth, state_code, first_name, last_name)
      values ('00000000-0000-4000-8000-00000000000c', 'Bad Name', '1990-01-01', 'NY', 'Casey', 'Test');
    raise exception 'FAIL: an invalid username was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.profiles (id, username, date_of_birth, state_code, first_name, last_name)
      values ('00000000-0000-4000-8000-00000000000c', 'rls_test_b', '1990-01-01', 'NY', 'Casey', 'Test');
    raise exception 'FAIL: a duplicate username was accepted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.profiles (id, username, date_of_birth, state_code, first_name, last_name)
      values ('00000000-0000-4000-8000-00000000000c', 'rls_test_c', '1990-01-01', 'XX', 'Casey', 'Test');
    raise exception 'FAIL: an invalid state code was accepted';
  exception when check_violation then null;
  end;

  insert into public.profiles (id, username, date_of_birth, state_code, first_name, last_name)
    values ('00000000-0000-4000-8000-00000000000c', 'rls.test-c', (current_date - interval '18 years')::date, 'DC', 'Casey', 'Test');
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FAIL: C sees % rows after creating a profile, expected 1', n; end if;
  if (select first_name || ' ' || last_name from public.profiles) <> 'Casey Test' then
    raise exception 'FAIL: C''s name wasn''t saved';
  end if;
end $$;

-- Apple sign-in's refresh tokens (T10, 0037): only the server's, never the app's. A has one.
reset role;
insert into public.apple_tokens (user_id, refresh_token) values ('00000000-0000-4000-8000-00000000000a', 'r.test-token');
do $$
begin
  if has_table_privilege('anon', 'public.apple_tokens', 'select') or has_table_privilege('authenticated', 'public.apple_tokens', 'select')
     or has_any_column_privilege('authenticated', 'public.apple_tokens', 'insert') or has_any_column_privilege('authenticated', 'public.apple_tokens', 'update')
     or has_table_privilege('authenticated', 'public.apple_tokens', 'delete') then
    raise exception 'FAIL: the app can touch Apple refresh tokens';
  end if;
  if not has_table_privilege('service_role', 'public.apple_tokens', 'select') or not has_table_privilege('service_role', 'public.apple_tokens', 'delete') then
    raise exception 'FAIL: the apple-token function can''t read or delete Apple refresh tokens';
  end if;
end $$;
set local role authenticated;

-- A deletes their own account
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.delete_account();

reset role;

do $$
begin
  if exists (select 1 from auth.users where id = '00000000-0000-4000-8000-00000000000a') then
    raise exception 'FAIL: delete_account() left the auth user in place';
  end if;
  if exists (select 1 from public.profiles where id = '00000000-0000-4000-8000-00000000000a') then
    raise exception 'FAIL: delete_account() left the profile in place';
  end if;
  if not exists (select 1 from public.profiles where id = '00000000-0000-4000-8000-00000000000b') then
    raise exception 'FAIL: delete_account() removed another user''s profile';
  end if;
  if (select state_code from public.profiles where id = '00000000-0000-4000-8000-00000000000b') <> 'CA' then
    raise exception 'FAIL: B''s state changed';
  end if;
  if exists (select 1 from public.apple_tokens where user_id = '00000000-0000-4000-8000-00000000000a') then
    raise exception 'FAIL: delete_account() left an Apple refresh token behind';
  end if;
end $$;

rollback;

select 'PASS: profiles privileges, RLS, constraints, real names, Settings edits, photos, username_available(), Apple refresh tokens and delete_account()' as result;
