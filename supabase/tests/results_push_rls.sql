-- Proves the results push is asked for (migration 0078, T177): once when a challenge finishes or doesn't, never
-- for a Day 1 cancel or an outcome that was already set.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/results_push_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a3', 'results-a@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values ('00000000-0000-4000-8000-0000000000a3', 'rp_test_a', '1990-01-01', 'OR');
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
select '00000000-0000-4000-8000-0000000000a3', h, 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now()
from unnest(array['read', 'journal', 'draw']) h;

delete from net.http_request_queue where url like '%/functions/v1/notify';
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() where user_id = '00000000-0000-4000-8000-0000000000a3' and habit_id = 'read';
update public.challenges set outcome = 'not_finished', ended_on_day = 9, ended_at = now() where user_id = '00000000-0000-4000-8000-0000000000a3' and habit_id = 'journal';
update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now() where user_id = '00000000-0000-4000-8000-0000000000a3' and habit_id = 'draw';
-- Setting the same outcome again asks nothing more.
update public.challenges set ended_at = now() where user_id = '00000000-0000-4000-8000-0000000000a3' and habit_id = 'read';

do $$
begin
  if (select count(*) from net.http_request_queue where url like '%/functions/v1/notify' and convert_from(body, 'utf8')::jsonb ? 'challenge_result') <> 2
     or exists (select 1 from net.http_request_queue where url like '%/functions/v1/notify'
                and convert_from(body, 'utf8')::jsonb ->> 'challenge_result' = (select id::text from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a3' and habit_id = 'draw')) then
    raise exception 'FAIL: the results push wasn''t asked once for each finish or failure, and never for a cancel';
  end if;
end $$;

rollback;

select 'PASS: the results push is asked for once when a challenge finishes or doesn''t, never for a cancel' as result;
