-- Push notifications with one phone (T34, T59, T55, T56; SPEC-notifications.md, Checkpoint H).
-- Your phone receives every push; this script plays the other people:
--   mr.kangs2, your second account (a friend), and kept.tester, a pretend stranger who can't sign in.
--
-- Before you start:
--   - migrations 0027-0031 pushed, `notify` deployed, the iOS push key set up (tasks/todo.md, T34);
--   - the new dev build on the phone, signed in as mr.kangs, with notifications allowed;
--   - before 10 pm Los Angeles time (after that, friends aren't pushed about check-ins).
-- Works before and after 0032 (T60: only friends who pledged review): each of you pledges on the
-- other's test challenge before reviewing it.
--
-- Run ONE block at a time in the Supabase SQL editor, in order, and check the phone after each.
-- Every block makes a real change. Block 7 removes everything this script made.
-- Tip: don't send a real photo on the test challenges; block 7 deletes the rows, not photo files.


-- ── Block 1: set up ─────────────────────────────────────────────────────────────────────────────
-- Makes kept.tester, and a public 364-day "Read" challenge for each account, both already on Day 1
-- (the demo clock). Starting after your friendship means each of you can review the other's check-ins.
-- You pledge $5 behind mr.kangs2's (that push goes to mr.kangs2, not you), so you may review it.
-- The 364-day length marks them for block 7. Nothing is pushed to your phone yet.
begin;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000f00d', 'kept.tester@kept.test')
  on conflict (id) do nothing;
insert into public.profiles (id, username, date_of_birth, state_code)
  values ('00000000-0000-4000-8000-00000000f00d', 'kept.tester', '1990-01-01', 'CA')
  on conflict (id) do nothing;
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, is_public)
  select id, 'read', 364, 1000, 'msf', 'card', 'America/Los_Angeles', now(), true
  from public.profiles where username in ('mr.kangs', 'mr.kangs2');
update public.challenges set day_offset = 1
  where length_days = 364 and outcome is null
    and user_id in (select id from public.profiles where username in ('mr.kangs', 'mr.kangs2'));
insert into public.pledges (challenge_id, pledger_id, amount_cents)
  select c.id, (select id from public.profiles where username = 'mr.kangs'), 500
  from public.challenges c join public.profiles p on p.id = c.user_id
  where p.username = 'mr.kangs2' and c.length_days = 364 and c.outcome is null;
commit;


-- ── Block 2: "Check-ins to review" (T34) ───────────────────────────────────────────────────────
-- mr.kangs2 checks in on their test challenge.
-- Expect on the phone: "@mr.kangs2 checked in" / "Day 1 of Read. Can you approve it?"
-- Tap it: the review screen opens (no photo, since SQL made the check-in). Approve it there.
insert into public.check_ins (challenge_id, day, status)
  select c.id, public.challenge_day(c), 'pending'
  from public.challenges c join public.profiles p on p.id = c.user_id
  where p.username = 'mr.kangs2' and c.length_days = 364 and c.outcome is null;


-- ── Block 3: "Someone backs you": a friend (T55) ───────────────────────────────────────────────
-- mr.kangs2 pledges $5 behind your test challenge, which also lets them review it (T60).
-- Expect, without a sound: "@mr.kangs2 backed you" / "They pledged behind Read." Tap: the challenge opens.
begin;
select set_config('kept.challenge', (
  select c.id::text from public.challenges c join public.profiles p on p.id = c.user_id
  where p.username = 'mr.kangs' and c.length_days = 364 and c.outcome is null), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where username = 'mr.kangs2'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.pledges (challenge_id, amount_cents) values (current_setting('kept.challenge')::uuid, 500);
commit;


-- ── Block 4a: "Your check-ins": a friend asks for a new photo (T59) ────────────────────────────
-- A check-in on your test challenge, then mr.kangs2 taps "Doesn't look right".
-- Expect: "@mr.kangs2 asked for a new photo" / "Day 1 of Read. Send a new one before 10 pm."
-- Tap it: your Day 1 check-in opens with mr.kangs2's note. Don't send a photo.
begin;
insert into public.check_ins (challenge_id, day, status)
  select c.id, public.challenge_day(c), 'pending'
  from public.challenges c join public.profiles p on p.id = c.user_id
  where p.username = 'mr.kangs' and c.length_days = 364 and c.outcome is null;
select set_config('kept.check_in', (
  select ci.id::text from public.check_ins ci join public.challenges c on c.id = ci.challenge_id join public.profiles p on p.id = c.user_id
  where p.username = 'mr.kangs' and c.length_days = 364 and c.outcome is null and ci.day = public.challenge_day(c)), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where username = 'mr.kangs2'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.check_ins set status = 'flagged', flag_note = 'Push test: a new photo, please.'
  where id = current_setting('kept.check_in')::uuid;
commit;


-- ── Block 4b: "Your check-ins": the AI asks for a retake (T59) ─────────────────────────────────
-- Plays Kept's AI (as the owner can in the dashboard): it takes the check-in and asks for a new photo.
-- Expect: "Take a new photo" / "Kept's AI couldn't confirm Day 1 of Read. Send a new one before midnight."
update public.check_ins ci set status = 'ai_checking'
  from public.challenges c join public.profiles p on p.id = c.user_id
  where ci.challenge_id = c.id and p.username = 'mr.kangs' and c.length_days = 364 and ci.day = public.challenge_day(c);
update public.check_ins ci set status = 'retake'
  from public.challenges c join public.profiles p on p.id = c.user_id
  where ci.challenge_id = c.id and p.username = 'mr.kangs' and c.length_days = 364 and ci.day = public.challenge_day(c);


-- ── Block 4c: "Your check-ins": not approved (T59) ─────────────────────────────────────────────
-- The day ends without a new photo, so the AI's retake becomes a rejection.
-- Expect, WITHOUT a sound: "Day 1 wasn't approved" / "... You can appeal within 7 days."
-- Tap it: Day 1 opens with Appeal.
update public.check_ins ci set status = 'rejected'
  from public.challenges c join public.profiles p on p.id = c.user_id
  where ci.challenge_id = c.id and p.username = 'mr.kangs' and c.length_days = 364 and ci.day = public.challenge_day(c);


-- ── Block 5: "Someone backs you": a backer (T55) ───────────────────────────────────────────────
-- kept.tester, a stranger, finds your public test challenge on Discover and pledges $5.
-- Expect, without a sound: "Someone backed you" / "They found Read on Discover and pledged behind it."
-- No name anywhere; the challenge shows them as "Backer A".
begin;
select set_config('kept.challenge', (
  select c.id::text from public.challenges c join public.profiles p on p.id = c.user_id
  where p.username = 'mr.kangs' and c.length_days = 364 and c.outcome is null), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000f00d","role":"authenticated"}', true);
set local role authenticated;
insert into public.pledges (challenge_id, amount_cents) values (current_setting('kept.challenge')::uuid, 500);
commit;


-- ── Block 6: "Friend requests" (T56) ───────────────────────────────────────────────────────────
-- kept.tester sends you a friend request.
-- Expect: "@kept.tester sent you a friend request" / "Accept it in Friends to see each other's challenges."
-- Tap it: Friends opens with the request. Decline it.
begin;
select set_config('kept.phone', (select id::text from public.profiles where username = 'mr.kangs'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000f00d","role":"authenticated"}', true);
set local role authenticated;
insert into public.friendships (addressee_id) values (current_setting('kept.phone')::uuid);
commit;


-- ── Block 7: clean up ──────────────────────────────────────────────────────────────────────────
-- Deletes both test challenges (their check-ins and pledges go with them) and kept.tester (with their
-- profile, request and pledge). Your real challenges and your friendship are untouched.
begin;
delete from public.challenges
  where length_days = 364 and user_id in (select id from public.profiles where username in ('mr.kangs', 'mr.kangs2'));
delete from auth.users where id = '00000000-0000-4000-8000-00000000f00d';
commit;
