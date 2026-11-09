-- Proves migrations 0046 and 0047 (the whole-codebase review, 2026-10-04): the AI answer can't go
-- back to "never asked"; a challenge still needs the signed promise, but the database, not the app,
-- sets when it was signed; and reports are limited to 10 an hour per person.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/hardening_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'hardening-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000e2', 'hardening-b@kept.test');

insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000e1', 'hard_test_a', '1990-01-01', 'NY'),
  ('00000000-0000-4000-8000-0000000000e2', 'hard_test_b', '1990-01-01', 'CA');

-- As A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);

do $$
declare
  signed timestamptz;
begin
  -- The AI answer: null → true → false → true is fine; back to null is refused.
  update public.profiles set ai_allowed = true where id = '00000000-0000-4000-8000-0000000000e1';
  update public.profiles set ai_allowed = false where id = '00000000-0000-4000-8000-0000000000e1';
  update public.profiles set ai_allowed = true where id = '00000000-0000-4000-8000-0000000000e1';
  begin
    update public.profiles set ai_allowed = null where id = '00000000-0000-4000-8000-0000000000e1';
    raise exception 'FAIL: the AI answer went back to never asked';
  exception when check_violation then
    if sqlerrm <> 'ai_choice_final' then raise; end if;
  end;

  -- A challenge's signing time is the database's, whatever the app sends.
  insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values ('read', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now() - interval '1 year')
    returning consented_at into signed;
  if signed < now() - interval '1 minute' then raise exception 'FAIL: the app backdated a signature'; end if;
  -- …and a challenge still needs one: the database sets when, never whether (0047).
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone)
      values ('cook', 28, 1000, 'aspca', 'card', 'America/Los_Angeles');
    raise exception 'FAIL: a challenge without consent was accepted';
  exception when not_null_violation then null;
  end;

  -- Ten reports an hour, then the eleventh is refused.
  for i in 1 .. 10 loop
    insert into public.reports (reported_id, reason) values ('00000000-0000-4000-8000-0000000000e2', 'spam');
  end loop;
  begin
    insert into public.reports (reported_id, reason) values ('00000000-0000-4000-8000-0000000000e2', 'spam');
    raise exception 'FAIL: an eleventh report in an hour was accepted';
  exception when check_violation then
    if sqlerrm <> 'report_rate_limited' then raise; end if;
  end;
end $$;

rollback;

select 'PASS: the AI answer is one-way; the database sets consented_at; reports are limited to 10 an hour' as result;
