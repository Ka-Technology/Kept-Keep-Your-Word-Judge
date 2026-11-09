-- Proves habitkept.com's waitlist rules (T90, migration 0049): anyone, signed out, can join with
-- join_waitlist(email), which stores it trimmed and in lowercase; joining twice is fine; a malformed
-- email is refused; and nobody can read or write the list directly, so the form can't be used to find
-- out whether an email is on it. Only the owner reads it, in the dashboard.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/waitlist_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select public.join_waitlist('  Someone@Example.COM ');
select public.join_waitlist('someone@example.com');
do $$
begin
  begin
    perform public.join_waitlist('not an email');
    raise exception 'FAIL: a malformed email joined the waitlist';
  exception when check_violation then null;
  end;
  begin
    perform public.join_waitlist(repeat('a', 250) || '@example.com');
    raise exception 'FAIL: an email over 254 characters joined the waitlist';
  exception when check_violation then null;
  end;
  begin
    perform 1 from public.waitlist;
    raise exception 'FAIL: a signed-out visitor read the waitlist';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.waitlist (email) values ('direct@example.com');
    raise exception 'FAIL: a signed-out visitor wrote the waitlist directly';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c9","role":"authenticated"}', true);
do $$
begin
  begin
    perform 1 from public.waitlist;
    raise exception 'FAIL: a signed-in user read the waitlist';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
do $$
begin
  if (select count(*) from public.waitlist where email = 'someone@example.com') <> 1 then
    raise exception 'FAIL: joining twice didn''t leave one trimmed, lowercase row';
  end if;
end $$;

rollback;

select 'PASS: anyone can join the waitlist (trimmed, lowercase, once); bad emails are refused; nobody reads or writes it directly' as result;
