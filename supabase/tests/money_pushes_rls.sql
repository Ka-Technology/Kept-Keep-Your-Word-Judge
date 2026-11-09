-- Proves the money pushes are asked for (migration 0069, T199, plan.md decision 160): `notify` is called with
-- { reward } when a finish puts real reward money in Kept balance; { money_waiting } for each backed return when
-- a challenge ends, and again on day 10 ({ reminder: true }, money_reminders(), once in its hour); { sent_back }
-- when a return reaches its card; { takeback } when a pledge in a reward is taken back. Pretend money (the demo)
-- and a return kept in Kept ask for nothing. Only the server can run the reminders.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/money_pushes_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a9', 'pushes-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b9', 'pushes-b@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a9', 'mp_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000b9', 'mp_test_b', '1990-01-01', 'CA');
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000b9', 'accepted', now());

do $$
begin
  if has_function_privilege('authenticated', 'public.money_reminders()', 'execute') then
    raise exception 'FAIL: the app can send money reminders';
  end if;
end $$;

-- A's Work out and Cook by card, each with B's $25 pledge, all paid; A's pretend Read with B's pretend pledge.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000a9', 'workout', 28, 2500, 'aspca', 'card', true, 'America/Los_Angeles', now()),
         ('00000000-0000-4000-8000-0000000000a9', 'cook', 28, 2000, 'aspca', 'card', true, 'America/Los_Angeles', now());
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000a9', 'read', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now());
create temporary table ids on commit drop as
  select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a9';
grant select on ids to authenticated;
insert into public.pledges (challenge_id, pledger_id, amount_cents, to_charity_on_finish)
  values ((select id from ids where habit_id = 'read'), '00000000-0000-4000-8000-0000000000b9', 2000, false);

do $$
declare
  h text;
  ch public.charges;
begin
  perform public.card_charge_succeeded(c.id, 'pi_mp_stake_' || c.id) from public.charges c where c.challenge_id in (select id from ids);
  foreach h in array array['workout', 'cook'] loop
    ch := public.pledge_charge('00000000-0000-4000-8000-0000000000b9', (select id from ids where habit_id = h), 2500, false, false);
    perform public.card_charge_succeeded(ch.id, 'pi_mp_pledge_' || h);
  end loop;
end $$;

create temporary view money_asks as
  select convert_from(body, 'utf8')::jsonb as body from net.http_request_queue where url like '%/functions/v1/notify';
delete from net.http_request_queue where url like '%/functions/v1/notify';

-- Work out finishes: the reward is in, and A's stake back waits. Read (pretend) finishes: nothing.
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() where id in (select id from ids where habit_id in ('workout', 'read'));

do $$
begin
  if (select count(*) from money_asks where body ->> 'reward' = (select id from ids where habit_id = 'workout')::text) <> 1 then
    raise exception 'FAIL: a finish with a real reward didn''t ask for "Your reward is in"';
  end if;
  if (select count(*) from money_asks where body ? 'money_waiting' and not (body ? 'reminder')) <> 1
     or (select body ->> 'money_waiting' from money_asks where body ? 'money_waiting')
        is distinct from (select id::text from public.payouts where challenge_id = (select id from ids where habit_id = 'workout') and kind = 'return') then
    raise exception 'FAIL: A''s stake back didn''t ask for "Money is waiting" once';
  end if;
  if exists (select 1 from money_asks where body ->> 'reward' = (select id from ids where habit_id = 'read')::text) then
    raise exception 'FAIL: pretend money asked for a push';
  end if;
end $$;

-- Cook is cancelled: A's stake and B's pledge both wait.
delete from net.http_request_queue where url like '%/functions/v1/notify';
update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now() where id = (select id from ids where habit_id = 'cook');

do $$
begin
  if (select count(*) from money_asks where body ? 'money_waiting') <> 2 or exists (select 1 from money_asks where body ? 'reward') then
    raise exception 'FAIL: a cancel didn''t ask "Money is waiting" for both returns, and nothing else';
  end if;
end $$;

-- A keeps the Cook stake in Kept (no push); B's pledge goes back to its card ("Sent back to your card").
delete from net.http_request_queue where url like '%/functions/v1/notify';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
select public.keep_in_balance((select id from public.my_money_back() where challenge_id = (select id from ids where habit_id = 'cook')));
reset role;
select set_config('request.jwt.claims', '', true);
select public.payout_sent((select id from public.payouts where challenge_id = (select id from ids where habit_id = 'cook') and source = 'pledge'), 'card');

do $$
begin
  if (select count(*) from money_asks) <> 1
     or (select body ->> 'sent_back' from money_asks)
        is distinct from (select id::text from public.payouts where challenge_id = (select id from ids where habit_id = 'cook') and source = 'pledge') then
    raise exception 'FAIL: only the return sent to its card should ask for "Sent back to your card"';
  end if;
end $$;

-- B's pledge on Work out gets a fraud warning: A's reward is taken back.
delete from net.http_request_queue where url like '%/functions/v1/notify';
select public.pledge_taken_back((select id from public.charges where user_id = '00000000-0000-4000-8000-0000000000b9'
                                 and challenge_id = (select id from ids where habit_id = 'workout')), 'fraud_warning');

do $$
begin
  if (select count(*) from money_asks where body ->> 'takeback' = (select id::text from public.balance_entries where source = 'takeback')) <> 1 then
    raise exception 'FAIL: a take-back didn''t ask for "A pledge was taken back"';
  end if;
end $$;

-- Day 10: Work out's stake return (still waiting) is reminded in its hour, once; one at day 11 isn't.
delete from net.http_request_queue where url like '%/functions/v1/notify';
update public.payouts set created_at = now() - interval '10 days 30 minutes'
  where challenge_id = (select id from ids where habit_id = 'workout') and kind = 'return';

do $$
declare
  n int;
begin
  n := public.money_reminders();
  if n <> 1 or (select count(*) from money_asks where (body ->> 'reminder')::boolean) <> 1 then
    raise exception 'FAIL: day 10 didn''t remind once';
  end if;
  update public.payouts set created_at = now() - interval '11 days'
    where challenge_id = (select id from ids where habit_id = 'workout') and kind = 'return';
  if public.money_reminders() <> 0 then raise exception 'FAIL: day 11 reminded again'; end if;
end $$;

rollback;

select 'PASS: money pushes asked for a real reward, each backed return waiting (at the end and on day 10, once), a return sent to its card, and a take-back; never for pretend money' as result;
