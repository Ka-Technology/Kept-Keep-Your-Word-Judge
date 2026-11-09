-- Proves delete_account() refuses mid-challenge (0052, plan.md decision 103): with a challenge that
-- hasn't ended, or a pledge on someone's challenge that hasn't ended, the account stays; once they've
-- ended, it goes. Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/delete_account_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'rls-del-challenger@kept.test'),
  ('00000000-0000-4000-8000-0000000000d2', 'rls-del-backer@kept.test');

insert into public.profiles (id, username, date_of_birth, state_code, first_name, last_name) values
  ('00000000-0000-4000-8000-0000000000d1', 'rls_del_challenger', '1990-01-01', 'NY', 'Dee', 'One'),
  ('00000000-0000-4000-8000-0000000000d2', 'rls_del_backer', '1990-01-01', 'CA', 'Dee', 'Two');

-- D1's public challenge, starting tomorrow (not ended), which D2 backs.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, is_public)
  values ('00000000-0000-4000-8000-0000000000d1', 'workout', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now(), true);
select set_config('test.d1_challenge', (select id::text from public.challenges where user_id = '00000000-0000-4000-8000-0000000000d1'), true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
insert into public.pledges (challenge_id, amount_cents) values (current_setting('test.d1_challenge')::uuid, 1000);

-- The backer can't leave while the challenge they back hasn't ended...
do $$
begin
  begin
    perform public.delete_account();
    raise exception 'FAIL: a backer deleted their account mid-challenge';
  exception when raise_exception then
    if sqlerrm <> 'money_still_promised' then raise; end if;
  end;
end $$;

-- ...nor the challenger while it runs.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.delete_account();
    raise exception 'FAIL: a challenger deleted their account mid-challenge';
  exception when raise_exception then
    if sqlerrm <> 'money_still_promised' then raise; end if;
  end;
end $$;

-- Once it has ended (cancelled here), both can go.
reset role;
update public.challenges set outcome = 'cancelled', ended_at = now() where id = current_setting('test.d1_challenge')::uuid;
set local role authenticated;
select public.delete_account();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
select public.delete_account();

reset role;
do $$
begin
  if exists (select 1 from auth.users where id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2')) then
    raise exception 'FAIL: an account with nothing running wasn''t deleted';
  end if;
end $$;

rollback;

select 'PASS: delete_account() refuses mid-challenge, for the challenger and their backers, and deletes once it has ended' as result;
