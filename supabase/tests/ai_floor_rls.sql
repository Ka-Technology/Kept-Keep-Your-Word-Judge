-- Proves the AI allowance's floor is a setting (migration 0088): ai_allowance() is the larger of the floor and 3 for each
-- running challenge; the floor starts at 4 (production's rule) and can be raised, never lowered below 4; and the setting
-- is the server's alone. Run on the test project after the migration is pushed:
--   npx supabase db query --linked --yes -f supabase/tests/ai_floor_rls.sql
-- It runs inside a transaction it rolls back, so the project's own floor is untouched.
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000f7', 'aifloor@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values ('00000000-0000-4000-8000-0000000000f7', 'aifloor', '1990-01-01', 'NY');

do $$
declare
  u uuid := '00000000-0000-4000-8000-0000000000f7';
begin
  -- The server's alone
  if has_table_privilege('authenticated', 'public.ai_settings', 'select') or has_table_privilege('authenticated', 'public.ai_settings', 'update')
     or has_table_privilege('anon', 'public.ai_settings', 'select') or has_table_privilege('anon', 'public.ai_settings', 'update') then
    raise exception 'FAIL: an app user can reach ai_settings';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.ai_settings'::regclass) then
    raise exception 'FAIL: RLS is off on ai_settings';
  end if;
  if (select count(*) from public.ai_settings) <> 1 then raise exception 'FAIL: ai_settings isn''t exactly one row'; end if;

  -- With no running challenge the allowance is the floor, whatever it is set to.
  update public.ai_settings set calls_floor = 4;
  if public.ai_allowance(u) <> 4 then raise exception 'FAIL: the default floor isn''t 4'; end if;
  update public.ai_settings set calls_floor = 30;
  if public.ai_allowance(u) <> 30 then raise exception 'FAIL: a floor of 30 isn''t the allowance of a user with no challenge'; end if;

  -- A running challenge counts 3, and the larger number wins: 3 doesn't beat a floor of 30 or of 4.
  insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values (u, 'stretch', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now());
  if public.ai_allowance(u) <> 30 then raise exception 'FAIL: one challenge changed a floor of 30'; end if;
  update public.ai_settings set calls_floor = 4;
  if public.ai_allowance(u) <> 4 then raise exception 'FAIL: one challenge at a floor of 4 isn''t 4 (3 for it, at least 4)'; end if;

  -- Never below the production rule.
  begin
    update public.ai_settings set calls_floor = 3;
    raise exception 'FAIL: the floor went below 4';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_settings (id, calls_floor) values (false, 4);
    raise exception 'FAIL: a second settings row was made';
  exception when check_violation or unique_violation then null;
  end;
end $$;

rollback;

select 'PASS: the AI allowance is the larger of the floor and 3 for each running challenge; the floor is 4 unless raised, never lower; the setting is the server''s alone' as result;
