-- Proves the pledges module's privileges, RLS policies, triggers and functions (migration 0022,
-- T31, SPEC-pledges.md): only a friend pledges on a running challenge that isn't theirs, whole
-- dollars from $5 to $100, one pledge each, $300 pending per person; a pledge is only raised, its
-- "donate anyway" choice only turned on, and it can be withdrawn only until the end of Day 1;
-- nobody reads another person's pledge rows; the challenger sees who backs them through
-- challenge_pledges(), and friends see only the total; the public choice (is_public) is set when
-- a challenge starts; extra gifts (0023, T32) come only after a challenge ends, only from its
-- challenger or a pledger, one each and raised only; public challenges (0024, T44), backers (0025,
-- T45) and a nameless public list (0027); delete_account() takes pledges and gifts with it.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/pledges_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A is the challenger, B is A's friend, C is a stranger to both.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a5', 'pledges-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b5', 'pledges-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000c5', 'pledges-c@kept.test');

insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a5', 'pl_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000b5', 'pl_test_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000c5', 'pl_test_c', '1990-01-01', 'TX');

insert into public.friendships (requester_id, addressee_id, status, accepted_at)
  values ('00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000b5', 'accepted', now());

-- A's four running challenges, created as the owner would (no user JWT). Each starts tomorrow (day 0).
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
select '00000000-0000-4000-8000-0000000000a5', habit, 28, 2000, 'msf', 'card', 'America/Los_Angeles', now()
from unnest(array['read', 'journal', 'meditate', 'stretch']) as habit;

create temporary table ids on commit drop as
  select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a5';
grant select on ids to authenticated;

do $$
begin
  if exists (select 1 from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a5' and is_public) then
    raise exception 'FAIL: a challenge is public without the challenger choosing it';
  end if;
end $$;

-- As B, A's friend
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b5","role":"authenticated"}', true);

do $$
declare
  ch1 uuid := (select id from ids where habit_id = 'read');
  ch2 uuid := (select id from ids where habit_id = 'journal');
  ch3 uuid := (select id from ids where habit_id = 'meditate');
  ch4 uuid := (select id from ids where habit_id = 'stretch');
  k text;
  n int;
begin
  insert into public.pledges (challenge_id, amount_cents) values (ch1, 2500);
  select kind into k from public.pledges where challenge_id = ch1;
  if k is distinct from 'supporter' then raise exception 'FAIL: a friend''s pledge is %, expected supporter', k; end if;

  -- One pledge per person per challenge.
  begin
    insert into public.pledges (challenge_id, amount_cents) values (ch1, 1000);
    raise exception 'FAIL: B pledged twice on one challenge';
  exception when unique_violation then null;
  end;

  -- Whole dollars from $5 to $100.
  begin
    insert into public.pledges (challenge_id, amount_cents) values (ch2, 400);
    raise exception 'FAIL: a $4 pledge was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.pledges (challenge_id, amount_cents) values (ch2, 2550);
    raise exception 'FAIL: a $25.50 pledge was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.pledges (challenge_id, amount_cents) values (ch2, 10100);
    raise exception 'FAIL: a $101 pledge was saved';
  exception when check_violation then null;
  end;

  -- The kind is the database's to set, and the pledger is always the signed-in user.
  begin
    insert into public.pledges (challenge_id, amount_cents, kind) values (ch2, 1000, 'backer');
    raise exception 'FAIL: B chose their own pledge kind';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.pledges set pledger_id = '00000000-0000-4000-8000-0000000000c5' where challenge_id = ch1;
    raise exception 'FAIL: B moved their pledge to someone else';
  exception when insufficient_privilege then null;
  end;

  -- Only raised, never lowered.
  begin
    update public.pledges set amount_cents = 2000 where challenge_id = ch1;
    raise exception 'FAIL: B lowered a pledge';
  exception when raise_exception then
    if sqlerrm <> 'pledge_only_raise' then raise; end if;
  end;
  update public.pledges set amount_cents = 4000 where challenge_id = ch1;

  -- "Donate even if they don't finish" is off by default, can be turned on, never back off.
  if (select donate_if_not_finished from public.pledges where challenge_id = ch1) then
    raise exception 'FAIL: donate anyway was on by default';
  end if;
  update public.pledges set donate_if_not_finished = true where challenge_id = ch1;
  begin
    update public.pledges set donate_if_not_finished = false where challenge_id = ch1;
    raise exception 'FAIL: B turned donate anyway back off';
  exception when raise_exception then
    if sqlerrm <> 'pledge_donate_stays_on' then raise; end if;
  end;

  -- $300 pending per person: $40 + $90 + $100 = $230; $80 more is too much, $70 fits exactly.
  insert into public.pledges (challenge_id, amount_cents) values (ch2, 9000), (ch3, 10000);
  begin
    insert into public.pledges (challenge_id, amount_cents) values (ch4, 8000);
    raise exception 'FAIL: B went over $300 pending';
  exception when raise_exception then
    if sqlerrm <> 'pledge_outstanding_limit' then raise; end if;
  end;
  insert into public.pledges (challenge_id, amount_cents) values (ch4, 7000);
  begin
    update public.pledges set amount_cents = 4100 where challenge_id = ch1;
    raise exception 'FAIL: raising a pledge went over $300 pending';
  exception when raise_exception then
    if sqlerrm <> 'pledge_outstanding_limit' then raise; end if;
  end;

  -- Withdrawn before Day 1: gone.
  delete from public.pledges where challenge_id = ch4;
  if exists (select 1 from public.pledges where challenge_id = ch4) then raise exception 'FAIL: B couldn''t withdraw before Day 1'; end if;

  -- B reads only their own pledges, and the total on a friend's challenge.
  select count(*) into n from public.pledges;
  if n <> 3 then raise exception 'FAIL: B reads % pledges, expected 3', n; end if;
  select pledgers into n from public.pledge_summaries(array[ch1]);
  if n is distinct from 1 then raise exception 'FAIL: B doesn''t see the pledge count on a friend''s challenge'; end if;
  select count(*) into n from public.challenge_pledges(ch1);
  if n <> 0 then raise exception 'FAIL: a supporter sees the challenger''s list of pledges'; end if;
  -- Wallet: B's own pledges, with whose challenge each backs.
  select count(*) into n from public.my_pledges() where challenger = 'pl_test_a' and charity = 'Doctors Without Borders';
  if n <> 3 then raise exception 'FAIL: my_pledges() shows % of B''s 3 pledges', n; end if;
end $$;

-- Day 1 and Day 2, as the owner would move the clock.
reset role;
select set_config('request.jwt.claims', '', true); -- the dashboard has no user
update public.challenges set day_offset = 1 where id = (select id from ids where habit_id = 'meditate');
update public.challenges set day_offset = 2 where id = (select id from ids where habit_id = 'read');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b5","role":"authenticated"}', true);

do $$
declare
  ch1 uuid := (select id from ids where habit_id = 'read');
  ch3 uuid := (select id from ids where habit_id = 'meditate');
begin
  -- Still Day 1: withdrawing works.
  delete from public.pledges where challenge_id = ch3;
  if exists (select 1 from public.pledges where challenge_id = ch3) then raise exception 'FAIL: B couldn''t withdraw on Day 1'; end if;
  -- Day 2: the pledge stays.
  delete from public.pledges where challenge_id = ch1;
  if not exists (select 1 from public.pledges where challenge_id = ch1) then raise exception 'FAIL: B withdrew a pledge on Day 2'; end if;
end $$;

-- A challenge that has ended takes no new pledges and no raises, but a refund can still become a donation.
reset role;
select set_config('request.jwt.claims', '', true); -- the dashboard has no user
update public.challenges set outcome = 'not_finished', ended_on_day = 1, ended_at = now()
  where id in (select id from ids where habit_id in ('journal', 'meditate'));

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b5","role":"authenticated"}', true);

do $$
declare
  ch2 uuid := (select id from ids where habit_id = 'journal');
  ch3 uuid := (select id from ids where habit_id = 'meditate');
  ch4 uuid := (select id from ids where habit_id = 'stretch');
begin
  begin
    update public.pledges set amount_cents = 9500 where challenge_id = ch2;
    raise exception 'FAIL: B raised a pledge on an ended challenge';
  exception when raise_exception then
    if sqlerrm <> 'pledge_challenge_ended' then raise; end if;
  end;
  update public.pledges set donate_if_not_finished = true where challenge_id = ch2;
  begin
    insert into public.pledges (challenge_id, amount_cents) values (ch3, 1000);
    raise exception 'FAIL: B pledged on an ended challenge';
  exception when raise_exception then
    if sqlerrm <> 'pledge_challenge_ended' then raise; end if;
  end;
  begin
    delete from public.pledges where challenge_id = ch2;
    if not exists (select 1 from public.pledges where challenge_id = ch2) then
      raise exception 'FAIL: B withdrew a pledge on an ended challenge';
    end if;
  end;
  -- Ended challenges don't count toward $300: $40 pending leaves room for $100 more.
  insert into public.pledges (challenge_id, amount_cents) values (ch4, 10000);

  -- Extra gifts (T32): after the end, from a pledger, one each, raised only.
  insert into public.extra_gifts (challenge_id, amount_cents) values (ch2, 1000);
  begin
    insert into public.extra_gifts (challenge_id, amount_cents) values (ch2, 500);
    raise exception 'FAIL: B gave twice on one challenge';
  exception when unique_violation then null;
  end;
  begin
    update public.extra_gifts set amount_cents = 500 where challenge_id = ch2;
    raise exception 'FAIL: B lowered a gift';
  exception when raise_exception then
    if sqlerrm <> 'gift_only_raise' then raise; end if;
  end;
  update public.extra_gifts set amount_cents = 1500 where challenge_id = ch2;
  begin
    insert into public.extra_gifts (challenge_id, amount_cents) values (ch4, 1000);
    raise exception 'FAIL: B gave on a running challenge';
  exception when raise_exception then
    if sqlerrm <> 'gift_challenge_running' then raise; end if;
  end;
  begin
    update public.extra_gifts set amount_cents = 15000 where challenge_id = ch2;
    raise exception 'FAIL: a $150 gift was saved';
  exception when check_violation then null;
  end;
end $$;

-- As C, a stranger
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c5","role":"authenticated"}', true);

do $$
declare
  ch1 uuid := (select id from ids where habit_id = 'read');
  ch4 uuid := (select id from ids where habit_id = 'stretch');
  n int;
begin
  begin
    insert into public.pledges (challenge_id, amount_cents) values (ch4, 1000);
    raise exception 'FAIL: a stranger pledged on a private challenge';
  exception when raise_exception then
    if sqlerrm <> 'pledge_not_friend' then raise; end if;
  end;
  select count(*) into n from public.pledges;
  if n <> 0 then raise exception 'FAIL: a stranger reads % pledges', n; end if;
  select count(*) into n from public.pledge_summaries(array[ch1, ch4]);
  if n <> 0 then raise exception 'FAIL: a stranger sees pledge totals'; end if;
  select count(*) into n from public.challenge_pledges(ch1);
  if n <> 0 then raise exception 'FAIL: a stranger sees who backs A'; end if;
  begin
    insert into public.extra_gifts (challenge_id, amount_cents) values ((select id from ids where habit_id = 'journal'), 1000);
    raise exception 'FAIL: a stranger added a gift';
  exception when raise_exception then
    if sqlerrm <> 'gift_not_allowed' then raise; end if;
  end;
  select count(*) into n from public.extra_gift_summary((select id from ids where habit_id = 'journal'));
  if n <> 0 then raise exception 'FAIL: a stranger sees the gifts on A''s challenge'; end if;
end $$;

-- As A, the challenger
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);

do $$
declare
  ch1 uuid := (select id from ids where habit_id = 'read');
  ch2 uuid := (select id from ids where habit_id = 'journal');
  ch4 uuid := (select id from ids where habit_id = 'stretch');
  r record;
  n int;
  total int;
begin
  begin
    insert into public.pledges (challenge_id, amount_cents) values (ch4, 1000);
    raise exception 'FAIL: A pledged on their own challenge';
  exception when raise_exception then
    if sqlerrm <> 'pledge_own_challenge' then raise; end if;
  end;
  -- Not B's rows directly, only through the function.
  select count(*) into n from public.pledges;
  if n <> 0 then raise exception 'FAIL: the challenger reads % pledge rows directly', n; end if;
  select * into r from public.challenge_pledges(ch1);
  if r.username is distinct from 'pl_test_b' or r.kind <> 'supporter' or r.amount_cents <> 4000 or not r.donate_if_not_finished or r.backer is not null then
    raise exception 'FAIL: challenge_pledges shows the wrong pledge: %', r;
  end if;
  select total_cents, pledgers into total, n from public.pledge_summaries(array[ch2]);
  if total is distinct from 9000 or n is distinct from 1 then raise exception 'FAIL: the summary is %, % pledgers', total, n; end if;

  -- The challenger gives too, reads only their own gift row, and sees the total.
  insert into public.extra_gifts (challenge_id, amount_cents) values (ch2, 2000);
  select count(*) into n from public.extra_gifts;
  if n <> 1 then raise exception 'FAIL: A reads % gift rows, expected their own 1', n; end if;
  select total_cents, givers into total, n from public.extra_gift_summary(ch2);
  if total is distinct from 3500 or n is distinct from 2 then raise exception 'FAIL: the gift summary is %, % givers', total, n; end if;

  -- The public choice is made when a challenge starts.
  insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, is_public)
    values ('study', 28, 2000, 'msf', 'card', 'America/Los_Angeles', now(), true);
  if not (select is_public from public.challenges where habit_id = 'study' and user_id = '00000000-0000-4000-8000-0000000000a5') then
    raise exception 'FAIL: the public choice wasn''t saved';
  end if;
end $$;

-- Public challenges and Discover (0024, T44). "stretch" moves to Day 8; "study" to Day 1, with a check-in waiting for review.
reset role;
select set_config('request.jwt.claims', '', true); -- the dashboard has no user
update public.challenges set day_offset = 8 where id = (select id from ids where habit_id = 'stretch');
update public.challenges set day_offset = 1 where user_id = '00000000-0000-4000-8000-0000000000a5' and habit_id = 'study';
insert into public.check_ins (challenge_id, day, status)
  select id, 1, 'pending' from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a5' and habit_id = 'study';
insert into ids select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a5' and habit_id = 'study';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);

do $$
declare
  study uuid := (select id from public.challenges where habit_id = 'study');
  ch4 uuid := (select id from ids where habit_id = 'stretch');
begin
  -- The challenger turns it off and on again during the first 7 days...
  update public.challenges set is_public = false where id = study;
  update public.challenges set is_public = true where id = study;
  -- ...but not on after Day 7, when backers couldn't pledge anyway.
  begin
    update public.challenges set is_public = true where id = ch4;
    raise exception 'FAIL: a challenge was made public after Day 7';
  exception when raise_exception then
    if sqlerrm <> 'public_too_late' then raise; end if;
  end;
end $$;

-- As C, a stranger: Discover shows A's public challenge, only its progress and never who it is
-- (0027: no username, photo or id), and never C's own.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c5","role":"authenticated"}', true);

do $$
declare
  study uuid;
  r record;
  n int;
begin
  insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, is_public)
    values ('read', 28, 1000, 'msf', 'card', 'America/Los_Angeles', now(), true);
  -- Found by id: the live project may hold real public challenges too.
  study := (select id from ids where habit_id = 'study');
  select count(*) into n from public.discover_challenges() where id = study;
  if n <> 1 then raise exception 'FAIL: Discover doesn''t show A''s public challenge to a stranger'; end if;
  select * into r from public.discover_challenges(study);
  if to_jsonb(r) ?| array['username', 'avatar_path', 'user_id'] then
    raise exception 'FAIL: Discover tells a stranger who the challenger is: %', r;
  end if;
  if r.habit_id <> 'study' or r.charity <> 'Doctors Without Borders' then
    raise exception 'FAIL: Discover shows the wrong challenge: %', r;
  end if;
  select count(*) into n from public.discover_challenges() d join public.challenges mine on mine.id = d.id
    where mine.user_id = '00000000-0000-4000-8000-0000000000c5';
  if n <> 0 then raise exception 'FAIL: Discover shows C their own public challenge'; end if;
  select count(*) into n from public.discover_challenges(study);
  if n <> 1 then raise exception 'FAIL: Discover can''t open one public challenge'; end if;
  select count(*) into n from public.discover_challenges((select id from ids where habit_id = 'read'));
  if n <> 0 then raise exception 'FAIL: Discover opened a private challenge'; end if;
  -- Still nothing from the challenges or check-ins tables themselves.
  select count(*) into n from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a5';
  if n <> 0 then raise exception 'FAIL: a stranger reads % of A''s challenges', n; end if;
  -- A stranger can't approve a check-in: the row is out of reach and stays pending.
  update public.check_ins set status = 'approved' where challenge_id = study;
  if (select r2.check_ins->0->>'status' from public.discover_challenges(study) r2) <> 'pending' then
    raise exception 'FAIL: a stranger approved a check-in';
  end if;
end $$;

-- A's friend B finds A's challenges in Discover's Friends group (the challenges table), not in the
-- public list (0027).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b5","role":"authenticated"}', true);

do $$
begin
  if exists (select 1 from public.discover_challenges() where id = (select id from ids where habit_id = 'study')) then
    raise exception 'FAIL: a friend''s public challenge is in the public list';
  end if;
end $$;

-- Backers (0025, T45). C backs A's public challenge in its first 7 days, as a backer.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c5","role":"authenticated"}', true);

do $$
declare
  study uuid := (select id from ids where habit_id = 'study');
  k text;
begin
  insert into public.pledges (challenge_id, amount_cents) values (study, 2000);
  select kind into k from public.pledges where challenge_id = study;
  if k is distinct from 'backer' then raise exception 'FAIL: a stranger''s pledge is %, expected backer', k; end if;
  -- Wallet doesn't name the challenger to a backer either (0027).
  if (select challenger from public.my_pledges() where challenge_id = study) is not null then
    raise exception 'FAIL: Wallet names the challenger to a backer';
  end if;
end $$;

-- A public challenge past Day 7 takes no new backers ("stretch" is on Day 8; the owner opens it).
reset role;
select set_config('request.jwt.claims', '', true); -- the dashboard has no user
update public.challenges set is_public = true where id = (select id from ids where habit_id = 'stretch');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c5","role":"authenticated"}', true);

do $$
begin
  begin
    insert into public.pledges (challenge_id, amount_cents) values ((select id from ids where habit_id = 'stretch'), 1000);
    raise exception 'FAIL: a backer pledged after Day 7';
  exception when raise_exception then
    if sqlerrm <> 'pledge_backer_window' then raise; end if;
  end;
end $$;

-- A sees the backer only by letter, then makes the challenge private.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);

do $$
declare
  study uuid := (select id from public.challenges where habit_id = 'study');
  r record;
begin
  select * into r from public.challenge_pledges(study);
  if r.kind <> 'backer' or r.backer is distinct from 'Backer A' or r.username is not null or r.avatar_path is not null then
    raise exception 'FAIL: the challenger sees a backer as %', r;
  end if;
  update public.challenges set is_public = false where id = study;
end $$;

-- The backer keeps seeing its progress; when it finishes, the backer badge counts it.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c5","role":"authenticated"}', true);

do $$
declare
  n int;
begin
  select count(*) into n from public.discover_challenges() where id = (select id from ids where habit_id = 'study');
  if n <> 1 then raise exception 'FAIL: a backer lost sight of a challenge made private'; end if;
  select public.backed_finished_count('00000000-0000-4000-8000-0000000000c5') into n;
  if n <> 0 then raise exception 'FAIL: the badge counted an unfinished challenge'; end if;
end $$;

reset role;
select set_config('request.jwt.claims', '', true); -- the dashboard has no user
update public.challenges set outcome = 'finished', ended_on_day = 1, ended_at = now()
  where user_id = '00000000-0000-4000-8000-0000000000a5' and habit_id = 'study';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c5","role":"authenticated"}', true);

do $$
begin
  if public.backed_finished_count('00000000-0000-4000-8000-0000000000c5') <> 1 then
    raise exception 'FAIL: the backer badge doesn''t count a finished challenge';
  end if;
end $$;

-- Only the person and their friends see the count: A isn't C's friend, but is B's.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);

do $$
begin
  if public.backed_finished_count('00000000-0000-4000-8000-0000000000c5') is not null then
    raise exception 'FAIL: a stranger''s backer badge count is visible';
  end if;
  if public.backed_finished_count('00000000-0000-4000-8000-0000000000b5') is distinct from 0 then
    raise exception 'FAIL: a friend''s backer badge count isn''t visible';
  end if;
end $$;

-- Discover lists only challenges a stranger can still back (0083, T205): one that has failed by misses (its
-- ending not yet written, as when its challenger hasn't opened Kept since) and one on Day 8 leave the list; one on
-- Day 7 stays, and so does one on Day 8 the stranger already backs (they can still raise it). Each still opens by id.
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, is_public)
select '00000000-0000-4000-8000-0000000000a5', habit, 28, 1000, 'msf', 'card', 'America/Los_Angeles', now(), true
from unnest(array['walk-run', 'workout', 'cook', 'chess']) as habit;
insert into ids select habit_id, id from public.challenges
  where user_id = '00000000-0000-4000-8000-0000000000a5' and habit_id in ('walk-run', 'workout', 'cook', 'chess');
-- C backs Chess on Day 1.
update public.challenges set day_offset = 1 where id = (select id from ids where habit_id = 'chess');
insert into public.pledges (challenge_id, pledger_id, amount_cents) values ((select id from ids where habit_id = 'chess'), '00000000-0000-4000-8000-0000000000c5', 1000);
-- Walk or run: Day 5, nothing checked in, so its misses ran out on Day 3. Work out and Chess: Day 8, every day kept.
-- Cook: Day 7, every day kept.
update public.challenges set day_offset = 5 where id = (select id from ids where habit_id = 'walk-run');
update public.challenges set day_offset = 8 where id in (select id from ids where habit_id in ('workout', 'chess'));
update public.challenges set day_offset = 7 where id = (select id from ids where habit_id = 'cook');
insert into public.check_ins (challenge_id, day, status)
select i.id, d, 'approved' from ids i, generate_series(1, 7) d where i.habit_id in ('workout', 'chess') or (i.habit_id = 'cook' and d < 7);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c5","role":"authenticated"}', true);

do $$
declare
  listed text[] := array(select i.habit_id from public.discover_challenges() d join ids i on i.id = d.id);
begin
  if 'walk-run' = any(listed) then raise exception 'FAIL: Discover lists a challenge that has ended'; end if;
  if 'workout' = any(listed) then raise exception 'FAIL: Discover lists a challenge on Day 8, past the backers'' window'; end if;
  if not 'cook' = any(listed) then raise exception 'FAIL: Discover dropped a challenge on Day 7'; end if;
  if not 'chess' = any(listed) then raise exception 'FAIL: Discover dropped a challenge its backer can still raise'; end if;
  if (select count(*) from public.discover_challenges((select id from ids where habit_id = 'walk-run'))) <> 1 then
    raise exception 'FAIL: an ended public challenge no longer opens by id';
  end if;
end $$;

-- B deletes their account: their pledges go with it. Since 0052 an account can't go while money is still
-- promised, so the owner first ends every challenge B is in or backs.
reset role;
select set_config('request.jwt.claims', '', true);
update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now()
  where outcome is null and (user_id = '00000000-0000-4000-8000-0000000000b5'
    or id in (select challenge_id from public.pledges where pledger_id = '00000000-0000-4000-8000-0000000000b5'));
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b5","role":"authenticated"}', true);
select public.delete_account();

reset role;
select set_config('request.jwt.claims', '', true); -- the dashboard has no user

do $$
begin
  if exists (select 1 from public.pledges where pledger_id = '00000000-0000-4000-8000-0000000000b5') then
    raise exception 'FAIL: delete_account() left B''s pledges behind';
  end if;
  if exists (select 1 from public.extra_gifts where giver_id = '00000000-0000-4000-8000-0000000000b5') then
    raise exception 'FAIL: delete_account() left B''s gifts behind';
  end if;
end $$;

rollback;

select 'PASS: pledges privileges, RLS, limits, raise-only, donate stays on, Day 1 withdrawal, ended challenges, reads, public choice, extra gifts, public challenges, backers and cascade' as result;
