-- Proves migrations 0042 and 0045 (badges, part 2; plan.md decisions 27 and 79): the showcase holds up to three badge
-- ids and only its owner sets it; badge_extras() answers only for yourself or an accepted friend;
-- badge_shares() lists every badge with its holders and Kept's users, and a recorded finish counts.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/badges_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A finishes a challenge; B is A's friend; C is a stranger.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000aa', 'badges-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000ab', 'badges-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000ac', 'badges-c@kept.test');

insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000aa', 'badge_test_a', '1990-01-01', 'NY'),
  ('00000000-0000-4000-8000-0000000000ab', 'badge_test_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000ac', 'badge_test_c', '1990-01-01', 'TX');

insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000ab', 'accepted', now());

-- A's public Read of 100 days, on Day 101 with every day approved: a finish with no missed day.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, day_offset, is_public)
  values ('00000000-0000-4000-8000-0000000000aa', 'read', 100, 1000, 'aspca', 'card', 'America/Los_Angeles', now(), 101, true);
select set_config('test.read', (select id::text from public.challenges where user_id = '00000000-0000-4000-8000-0000000000aa'), true);
select set_config('test.users_before', (select max(users)::text from public.badge_shares()), true);
insert into public.check_ins (challenge_id, day, status)
  select current_setting('test.read')::uuid, d, 'approved' from generate_series(1, 100) d;
-- Every badge's holders before the finish is recorded (A already holds First step and First check-in).
select set_config('test.before', (select json_object_agg(badge_id, holders)::text from public.badge_shares()), true);
-- As the owner (or the server) records it.
update public.challenges set outcome = 'finished', ended_on_day = 100, ended_at = now() where id = current_setting('test.read')::uuid;

-- As A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);

do $$
declare
  n int;
begin
  -- Shares: every badge, A's finish counted, and every profile in the user count.
  select count(*) into n from public.badge_shares();
  if n <> 27 then raise exception 'FAIL: badge_shares() listed % badges, expected 27', n; end if;
  -- The finish adds A to exactly the badges it earns: 100 days, public, no missed day, a $10 stake.
  if exists (
    select 1 from public.badge_shares() s
    where s.holders - (current_setting('test.before')::json ->> s.badge_id)::int
       <> case when s.badge_id in ('kept-it', 'unbroken', 'long-haul', 'century', 'in-the-open') then 1 else 0 end
  ) then
    raise exception 'FAIL: a recorded finish changed the wrong badges: %', (
      select string_agg(s.badge_id || ' ' || (s.holders - (current_setting('test.before')::json ->> s.badge_id)::int), ', ')
      from public.badge_shares() s);
  end if;
  if (select max(users) from public.badge_shares()) <> current_setting('test.users_before')::int then
    raise exception 'FAIL: badge_shares() users changed without a new profile';
  end if;

  -- The showcase: up to three ids, a-z and dashes, set only on your own row.
  update public.profiles set showcase_badges = '{kept-it,unbroken}' where id = '00000000-0000-4000-8000-0000000000aa';
  begin
    update public.profiles set showcase_badges = '{a,b,c,d}' where id = '00000000-0000-4000-8000-0000000000aa';
    raise exception 'FAIL: a showcase of four was saved';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set showcase_badges = '{"Kept it"}' where id = '00000000-0000-4000-8000-0000000000aa';
    raise exception 'FAIL: a badge id with capitals and a space was saved';
  exception when check_violation then null;
  end;
  update public.profiles set showcase_badges = '{kept-it}' where id = '00000000-0000-4000-8000-0000000000ab';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: A set B''s showcase'; end if;

  if (select showcase from public.badge_extras('00000000-0000-4000-8000-0000000000aa')) <> '{kept-it,unbroken}' then
    raise exception 'FAIL: A can''t read their own showcase';
  end if;
  select count(*) into n from public.badge_extras('00000000-0000-4000-8000-0000000000ac');
  if n <> 0 then raise exception 'FAIL: A read a stranger''s badge extras'; end if;
end $$;

-- As B, A's friend: sees A's showcase and counts.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000ab","role":"authenticated"}', true);
do $$
begin
  if (select showcase from public.badge_extras('00000000-0000-4000-8000-0000000000aa')) is distinct from '{kept-it,unbroken}' then
    raise exception 'FAIL: a friend can''t read the showcase';
  end if;
  if (select backed + supported from public.badge_extras('00000000-0000-4000-8000-0000000000aa')) <> 0 then
    raise exception 'FAIL: pledge counts for someone who pledged nothing';
  end if;
end $$;

-- As C, a stranger: nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000ac","role":"authenticated"}', true);
do $$
declare
  n int;
begin
  select count(*) into n from public.badge_extras('00000000-0000-4000-8000-0000000000aa');
  if n <> 0 then raise exception 'FAIL: a stranger read badge extras'; end if;
  if has_function_privilege('anon', 'public.badge_extras(uuid)', 'execute') or has_function_privilege('anon', 'public.badge_shares()', 'execute') then
    raise exception 'FAIL: anon can call badge_extras() or badge_shares()';
  end if;
end $$;

rollback;

select 'PASS: the showcase holds up to 3 ids, set only by its owner; badge_extras() for yourself and friends only; badge_shares() counts every badge' as result;
