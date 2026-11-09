-- A standing guard over every migration, past and future (owner request, 2026-09-27): each table in
-- `public` has RLS on; no policy there or on storage.objects is open to signed-out users (`anon`) or
-- to every role (`public`); `anon` holds no table privileges in `public`; and every SECURITY DEFINER
-- function pins its search_path, with only username_available() (sign-up checks the name before the
-- account exists, migration 0011) and join_waitlist() (habitkept.com's waitlist form, 0049, T90)
-- callable signed out. The service_role key bypasses RLS and lives
-- only in Supabase's own Edge Function environment, never in this repo.
-- Run: npx supabase db query --linked -f supabase/tests/rls_everywhere.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

do $$
declare
  bad text;
begin
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if bad is not null then raise exception 'FAIL: RLS is off on %', bad; end if;

  select string_agg(p.schemaname || '.' || p.tablename || ' "' || p.policyname || '"', ', ') into bad
    from pg_policies p
    where (p.schemaname = 'public' or (p.schemaname = 'storage' and p.tablename = 'objects'))
      and p.roles && array['public', 'anon']::name[];
  if bad is not null then raise exception 'FAIL: policies open to anon or public: %', bad; end if;

  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
      and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'));
  if bad is not null then raise exception 'FAIL: anon has table privileges on %', bad; end if;

  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proconfig is null;
  if bad is not null then raise exception 'FAIL: SECURITY DEFINER without a pinned search_path: %', bad; end if;

  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proname not in ('username_available', 'join_waitlist')
      and has_function_privilege('anon', p.oid, 'EXECUTE');
  if bad is not null then raise exception 'FAIL: anon can call SECURITY DEFINER %', bad; end if;
end $$;

select 'PASS: RLS on every public table, nothing open to anon, definer functions pinned and closed' as result;
