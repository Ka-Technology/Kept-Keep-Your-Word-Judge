-- Proves the health-habit consent's column (migration 0075, T179, plan.md decision 119): profiles.health_allowed
-- is null until asked, and only its owner sets it, either way.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/health_consent_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000af', 'health-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000bf', 'health-b@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000af', 'hc_test_a', '1990-01-01', 'WA'),
  ('00000000-0000-4000-8000-0000000000bf', 'hc_test_b', '1990-01-01', 'NV');

do $$
begin
  if (select health_allowed from public.profiles where id = '00000000-0000-4000-8000-0000000000af') is not null then
    raise exception 'FAIL: health habits are answered before anyone asked';
  end if;
  if has_column_privilege('anon', 'public.profiles', 'health_allowed', 'update') then raise exception 'FAIL: anon can set the health answer'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000af","role":"authenticated"}', true);
update public.profiles set health_allowed = true where id = '00000000-0000-4000-8000-0000000000af';
update public.profiles set health_allowed = false where id = '00000000-0000-4000-8000-0000000000af';
update public.profiles set health_allowed = true where id = '00000000-0000-4000-8000-0000000000bf';
reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if (select health_allowed from public.profiles where id = '00000000-0000-4000-8000-0000000000af') is distinct from false then
    raise exception 'FAIL: A couldn''t answer for themselves';
  end if;
  if (select health_allowed from public.profiles where id = '00000000-0000-4000-8000-0000000000bf') is not null then
    raise exception 'FAIL: A answered for B';
  end if;
end $$;

rollback;

select 'PASS: the health answer is null until asked, and only its owner sets it' as result;
