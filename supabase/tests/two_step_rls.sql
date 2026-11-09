-- Proves two-step recovery's table (migration 0077, T161): only the server reads or writes a recovery code's hash.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/two_step_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

do $$
begin
  if has_table_privilege('authenticated', 'public.two_step_recovery', 'select')
     or has_table_privilege('authenticated', 'public.two_step_recovery', 'insert')
     or has_table_privilege('authenticated', 'public.two_step_recovery', 'update')
     or has_table_privilege('anon', 'public.two_step_recovery', 'select') then
    raise exception 'FAIL: the app can read or write two-step recovery codes';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.two_step_recovery'::regclass) then
    raise exception 'FAIL: two_step_recovery has no row-level security';
  end if;
end $$;

rollback;

select 'PASS: two-step recovery codes are the server''s alone' as result;
