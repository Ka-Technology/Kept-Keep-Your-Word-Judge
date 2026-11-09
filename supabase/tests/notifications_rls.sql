-- Proves the notifications module's privileges, RLS policies, functions and triggers (migrations
-- 0028-0031, T34, T59, T55 and T56, SPEC-notifications.md): a user sees and changes only their own push tokens and only
-- their switches; a token registered by another account moves to it, with its switches reset;
-- review_push_tokens() returns only eligible friends (accepted before Day 1, who pledged: T60) with reviews on, and
-- only to the server; tokens go with the account; and a check-in waiting for friends queues a call
-- to the `notify` Edge Function, as do a check-in that needs a new photo or wasn't approved, a
-- new pledge and a friend request, while other changes don't.
-- Everything runs in one transaction that is rolled back, so no test data persists (the queued
-- calls included: pg_net sends only after a commit).
-- Run: npx supabase db query --linked -f supabase/tests/notifications_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A is the challenger. B is a friend from before Day 1, C a friend from after it, D no friend,
-- E a friend from before Day 1 with "Check-ins to review" off.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a7', 'notify-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b7', 'notify-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000c7', 'notify-c@kept.test'),
  ('00000000-0000-4000-8000-0000000000d7', 'notify-d@kept.test'),
  ('00000000-0000-4000-8000-0000000000e7', 'notify-e@kept.test');

insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a7', 'nt_test_a', '1990-01-01', 'NY'),
  ('00000000-0000-4000-8000-0000000000b7', 'nt_test_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000c7', 'nt_test_c', '1990-01-01', 'TX'),
  ('00000000-0000-4000-8000-0000000000d7', 'nt_test_d', '1990-01-01', 'WA'),
  ('00000000-0000-4000-8000-0000000000e7', 'nt_test_e', '1990-01-01', 'OR');

-- A's challenge: the insert trigger makes Day 1 tomorrow, and the demo clock moves it to today, so
-- A can check in.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000a7', 'read', 28, 2000, 'msf', 'card', 'America/Los_Angeles', now());
update public.challenges set day_offset = 1 where user_id = '00000000-0000-4000-8000-0000000000a7';

insert into public.friendships (requester_id, addressee_id, status, accepted_at)
  select '00000000-0000-4000-8000-0000000000a7', f.id, 'accepted', f.accepted_at
  from (values
    ('00000000-0000-4000-8000-0000000000b7'::uuid, now() - interval '1 day'),
    ('00000000-0000-4000-8000-0000000000c7'::uuid, now() + interval '3 days'),
    ('00000000-0000-4000-8000-0000000000e7'::uuid, now() - interval '1 day')
  ) as f(id, accepted_at);

-- Privileges
do $$
begin
  if has_table_privilege('anon', 'public.push_tokens', 'select') or has_any_column_privilege('anon', 'public.push_tokens', 'insert')
     or has_any_column_privilege('anon', 'public.push_tokens', 'update') or has_table_privilege('anon', 'public.push_tokens', 'delete') then
    raise exception 'FAIL: anon has access to push_tokens';
  end if;
  if has_any_column_privilege('authenticated', 'public.push_tokens', 'insert') then
    raise exception 'FAIL: authenticated can insert push_tokens directly (only register_push_token may)';
  end if;
  if has_column_privilege('authenticated', 'public.push_tokens', 'user_id', 'update')
     or has_column_privilege('authenticated', 'public.push_tokens', 'token', 'update')
     or not has_column_privilege('authenticated', 'public.push_tokens', 'reviews', 'update')
     or not has_column_privilege('authenticated', 'public.push_tokens', 'check_ins', 'update')
     or not has_column_privilege('authenticated', 'public.push_tokens', 'pledges', 'update')
     or not has_column_privilege('authenticated', 'public.push_tokens', 'friends', 'update') then
    raise exception 'FAIL: authenticated may update something other than the switches';
  end if;
  if has_function_privilege('anon', 'public.register_push_token(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.register_push_token(text)', 'execute') then
    raise exception 'FAIL: register_push_token() is open to anon, or closed to authenticated';
  end if;
  if has_function_privilege('anon', 'public.review_push_tokens(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.review_push_tokens(uuid)', 'execute') then
    raise exception 'FAIL: review_push_tokens() is callable from the app';
  end if;
end $$;

-- Each person registers their phone.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a7","role":"authenticated"}', true);
select public.register_push_token('ExponentPushToken[nt-a]');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c7","role":"authenticated"}', true);
select public.register_push_token('ExponentPushToken[nt-c]');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d7","role":"authenticated"}', true);
select public.register_push_token('ExponentPushToken[nt-d]');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e7","role":"authenticated"}', true);
select public.register_push_token('ExponentPushToken[nt-e]');
update public.push_tokens set reviews = false;

-- B signs in on the phone D used: the token moves to B, with the switches back on.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d7","role":"authenticated"}', true);
update public.push_tokens set reviews = false;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b7","role":"authenticated"}', true);
select public.register_push_token('ExponentPushToken[nt-d]');

do $$
begin
  if (select count(*) from public.push_tokens) <> 1 then
    raise exception 'FAIL: B sees tokens other than their own';
  end if;
  if not (select reviews from public.push_tokens where token = 'ExponentPushToken[nt-d]') then
    raise exception 'FAIL: a token that moved kept the previous account''s switches';
  end if;
  begin
    perform public.register_push_token('not a token');
    raise exception 'FAIL: register_push_token() took something that isn''t an Expo push token';
  exception when check_violation then null;
  end;
end $$;

-- Registering again changes nothing, and B can't touch A's token.
select public.register_push_token('ExponentPushToken[nt-d]');
update public.push_tokens set reviews = false where token = 'ExponentPushToken[nt-a]';
delete from public.push_tokens where token = 'ExponentPushToken[nt-a]';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d7","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.push_tokens) then
    raise exception 'FAIL: D still sees the token that moved to B';
  end if;
end $$;

reset role;

do $$
begin
  if (select count(*) from public.push_tokens where token like 'ExponentPushToken[nt-%') <> 4
     or not (select reviews from public.push_tokens where token = 'ExponentPushToken[nt-a]') then
    raise exception 'FAIL: B changed or deleted A''s token';
  end if;
  if (select user_id from public.push_tokens where token = 'ExponentPushToken[nt-d]') <> '00000000-0000-4000-8000-0000000000b7' then
    raise exception 'FAIL: the token didn''t move to B';
  end if;
end $$;

-- A check-in waiting for friends: only B (before Day 1, reviews on) is pushed, never A, C, D or E,
-- and the notify function is called for it. The status changes below are made as the owner (no
-- user), which the check-in rules allow; the trigger fires the same for every actor.
select set_config('request.jwt.claims', '', true);
delete from net.http_request_queue where url like '%/functions/v1/notify';
insert into public.check_ins (challenge_id, day, status)
  select id, 1, 'pending' from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a7';

-- Only friends who back the challenge are pushed (T60). C (after Day 1) and E (reviews off) pledge
-- and still get nothing; B gets nothing until B pledges too. The owner makes these pledges; their
-- own calls to notify (T55) are cleared, so the counts below stay about check-ins.
insert into public.pledges (challenge_id, pledger_id, amount_cents)
  select c.id, p.id, 500 from public.challenges c,
    (values ('00000000-0000-4000-8000-0000000000c7'::uuid), ('00000000-0000-4000-8000-0000000000e7'::uuid)) as p(id)
  where c.user_id = '00000000-0000-4000-8000-0000000000a7';

do $$
declare
  ci uuid := (select ci.id from public.check_ins ci join public.challenges c on c.id = ci.challenge_id
              where c.user_id = '00000000-0000-4000-8000-0000000000a7');
begin
  if exists (select 1 from public.review_push_tokens(ci)) then
    raise exception 'FAIL: review_push_tokens() pushed a friend who hasn''t pledged: %', (select array_agg(token) from public.review_push_tokens(ci));
  end if;
end $$;

insert into public.pledges (challenge_id, pledger_id, amount_cents)
  select id, '00000000-0000-4000-8000-0000000000b7', 500 from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a7';
delete from net.http_request_queue where url like '%/functions/v1/notify' and convert_from(body, 'utf8')::jsonb ? 'pledge';

do $$
declare
  ci uuid := (select ci.id from public.check_ins ci join public.challenges c on c.id = ci.challenge_id
              where c.user_id = '00000000-0000-4000-8000-0000000000a7');
begin
  if (select array_agg(token) from public.review_push_tokens(ci)) is distinct from array['ExponentPushToken[nt-d]'] then
    raise exception 'FAIL: review_push_tokens() returned %', (select array_agg(token) from public.review_push_tokens(ci));
  end if;
  if (select count(*) from net.http_request_queue
      where url like '%/functions/v1/notify' and convert_from(body, 'utf8')::jsonb = jsonb_build_object('check_in', ci, 'new_photo', false)) <> 1 then
    raise exception 'FAIL: a new check-in didn''t queue exactly one call to notify';
  end if;
  if (select headers ->> 'apikey' from net.http_request_queue where url like '%/functions/v1/notify' limit 1) is null then
    raise exception 'FAIL: the call to notify has no secret key';
  end if;

  -- A friend's flag (a result for the challenger), then a new photo (friends again), then the AI:
  -- a retake, a rejection after it, and a rejection straight from checking are results. The AI
  -- taking it, and an approval, call nothing.
  update public.check_ins set status = 'flagged' where id = ci;
  update public.check_ins set status = 'pending' where id = ci;
  update public.check_ins set status = 'ai_checking' where id = ci;
  update public.check_ins set status = 'retake' where id = ci;
  update public.check_ins set status = 'rejected' where id = ci;
  update public.check_ins set status = 'ai_checking' where id = ci;
  update public.check_ins set status = 'rejected' where id = ci;
  update public.check_ins set status = 'approved' where id = ci;
  if (select count(*) from net.http_request_queue
      where url like '%/functions/v1/notify' and convert_from(body, 'utf8')::jsonb = jsonb_build_object('check_in', ci, 'new_photo', true)) <> 1
     or (select count(*) from net.http_request_queue
         where url like '%/functions/v1/notify' and convert_from(body, 'utf8')::jsonb = jsonb_build_object('check_in_result', ci)) <> 4
     or (select count(*) from net.http_request_queue where url like '%/functions/v1/notify') <> 6 then
    raise exception 'FAIL: expected 2 review calls and 4 result calls, got % in all',
      (select count(*) from net.http_request_queue where url like '%/functions/v1/notify');
  end if;
end $$;

-- The owner removes the pledges above, so B can pledge afresh below.
delete from public.pledges where pledger_id in
  ('00000000-0000-4000-8000-0000000000b7', '00000000-0000-4000-8000-0000000000c7', '00000000-0000-4000-8000-0000000000e7');

-- B (a friend) pledges behind A's challenge: one call to notify. Raising it and withdrawing it
-- (allowed on Day 1) call nothing.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b7","role":"authenticated"}', true);
insert into public.pledges (challenge_id, amount_cents)
  select id, 2500 from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a7';
update public.pledges set amount_cents = 3000;
delete from public.pledges;
reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if (select count(*) from net.http_request_queue
      where url like '%/functions/v1/notify' and convert_from(body, 'utf8')::jsonb ? 'pledge') <> 1 then
    raise exception 'FAIL: expected one call to notify for the new pledge, got %',
      (select count(*) from net.http_request_queue where url like '%/functions/v1/notify' and convert_from(body, 'utf8')::jsonb ? 'pledge');
  end if;
end $$;

-- C asks D to be friends: one call to notify. D accepting it, and unfriending, call nothing.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c7","role":"authenticated"}', true);
insert into public.friendships (addressee_id) values ('00000000-0000-4000-8000-0000000000d7');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d7","role":"authenticated"}', true);
update public.friendships set status = 'accepted' where requester_id = '00000000-0000-4000-8000-0000000000c7';
delete from public.friendships where requester_id = '00000000-0000-4000-8000-0000000000c7';
reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if (select count(*) from net.http_request_queue
      where url like '%/functions/v1/notify' and convert_from(body, 'utf8')::jsonb ? 'friend_request') <> 1 then
    raise exception 'FAIL: expected one call to notify for the friend request, got %',
      (select count(*) from net.http_request_queue where url like '%/functions/v1/notify' and convert_from(body, 'utf8')::jsonb ? 'friend_request');
  end if;
end $$;

-- Tokens go with the account.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b7","role":"authenticated"}', true);
select public.delete_account();
reset role;

do $$
begin
  if exists (select 1 from public.push_tokens where user_id = '00000000-0000-4000-8000-0000000000b7') then
    raise exception 'FAIL: delete_account() left B''s push tokens behind';
  end if;
end $$;

rollback;

select 'PASS: push_tokens privileges and RLS, register_push_token() and moving a token, review_push_tokens(), the notify trigger, and the cascade' as result;
