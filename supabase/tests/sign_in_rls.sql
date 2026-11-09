-- Proves the sign-in failure counter (0051, T147) is the server's alone: the app, signed in or out,
-- can't read, add or clear it, and the sign-in function (service role) can. Rows go with the account.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/sign_in_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000f1', 'rls-signin@kept.test');
insert into public.sign_in_failures (user_id) values ('00000000-0000-4000-8000-0000000000f1');

do $$
begin
  if has_table_privilege('anon', 'public.sign_in_failures', 'select') or has_table_privilege('anon', 'public.sign_in_failures', 'insert')
     or has_table_privilege('anon', 'public.sign_in_failures', 'delete') then
    raise exception 'FAIL: signed out, the app can touch sign-in failures';
  end if;
  if has_table_privilege('authenticated', 'public.sign_in_failures', 'select') or has_table_privilege('authenticated', 'public.sign_in_failures', 'insert')
     or has_table_privilege('authenticated', 'public.sign_in_failures', 'delete') or has_any_column_privilege('authenticated', 'public.sign_in_failures', 'update') then
    raise exception 'FAIL: signed in, the app can touch sign-in failures';
  end if;
  if not has_table_privilege('service_role', 'public.sign_in_failures', 'select') or not has_table_privilege('service_role', 'public.sign_in_failures', 'insert')
     or not has_table_privilege('service_role', 'public.sign_in_failures', 'delete') then
    raise exception 'FAIL: the sign-in function can''t count or clear failures';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.sign_in_failures'::regclass) then
    raise exception 'FAIL: row-level security is off on sign_in_failures';
  end if;
end $$;

delete from auth.users where id = '00000000-0000-4000-8000-0000000000f1';

do $$
begin
  if exists (select 1 from public.sign_in_failures where user_id = '00000000-0000-4000-8000-0000000000f1') then
    raise exception 'FAIL: a deleted account''s sign-in failures stayed';
  end if;
end $$;

rollback;

select 'PASS: sign-in failures are the server''s alone and go with the account' as result;
