-- Proves rewards and payouts (migration 0060, T188, plan.md decisions 143 and 144): when a challenge
-- ends, the database writes the money that goes back to people, the same rows as payouts() in
-- challenge-rules.ts: finished, the stake back and each pledge to the finisher as their reward unless
-- its pledger chose the charity; not finished, each pledge back unless donated; cancelled, everything
-- back. With the donations, every dollar of the stake and pledges is accounted for. The choice can change
-- for 24 hours after the pledge is paid (0064) and never once the challenge has ended; nobody writes a payout from the app; each person reads only
-- their own, never whose money a reward was; and a payout that moved money is never changed.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked --project-ref <ref> -f supabase/tests/payouts_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A is the challenger; B and C are A's friends who pledge; D is a stranger.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a7', 'payouts-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b7', 'payouts-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000c7', 'payouts-c@kept.test'),
  ('00000000-0000-4000-8000-0000000000d7', 'payouts-d@kept.test');

insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a7', 'po_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000b7', 'po_test_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000c7', 'po_test_c', '1990-01-01', 'TX'),
  ('00000000-0000-4000-8000-0000000000d7', 'po_test_d', '1990-01-01', 'WA');

insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000a7', '00000000-0000-4000-8000-0000000000b7', 'accepted', now()),
  ('00000000-0000-4000-8000-0000000000a7', '00000000-0000-4000-8000-0000000000c7', 'accepted', now());

-- A's challenges: Work out ($35, v2's worked example), Read ($20) and Journal ($20), all for the ASPCA.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000a7', 'read', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now());
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  select '00000000-0000-4000-8000-0000000000a7', h, 28, s, 'aspca', 'card', 'America/Los_Angeles', now()
  from (values ('workout', 3500), ('journal', 2000)) as v(h, s);

create temporary table ids on commit drop as
  select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a7';
grant select on ids to authenticated;

-- The pledges: on Work out, B's $25 rewards and C's $25 is set to the charity; on Read, B's $25 plain and
-- C's $10 "donate either way"; on Journal, B's $25 set to the charity both ways.
insert into public.pledges (challenge_id, pledger_id, amount_cents, donate_if_not_finished, to_charity_on_finish)
  select i.id, p.who, p.cents, p.anyway, p.charity
  from ids i join (values
    ('workout', '00000000-0000-4000-8000-0000000000b7'::uuid, 2500, false, false),
    ('workout', '00000000-0000-4000-8000-0000000000c7'::uuid, 2500, false, true),
    ('read',    '00000000-0000-4000-8000-0000000000b7'::uuid, 2500, false, false),
    ('read',    '00000000-0000-4000-8000-0000000000c7'::uuid, 1000, true,  false),
    ('journal', '00000000-0000-4000-8000-0000000000b7'::uuid, 2500, true,  true)
  ) as p(habit, who, cents, anyway, charity) on p.habit = i.habit_id;

-- Privileges: reading only, signed in, and never whose money a reward was.
do $$
begin
  if has_table_privilege('anon', 'public.payouts', 'select') then raise exception 'FAIL: anon can read payouts'; end if;
  if not has_column_privilege('authenticated', 'public.payouts', 'amount_cents', 'select') then
    raise exception 'FAIL: a signed-in user can''t read their payouts';
  end if;
  if has_column_privilege('authenticated', 'public.payouts', 'giver_id', 'select') then
    raise exception 'FAIL: the app can read whose money a payout was (a backer would lose their anonymity)';
  end if;
  if has_any_column_privilege('authenticated', 'public.payouts', 'insert')
     or has_any_column_privilege('authenticated', 'public.payouts', 'update')
     or has_table_privilege('authenticated', 'public.payouts', 'delete') then
    raise exception 'FAIL: the app can write payouts';
  end if;
  if has_function_privilege('authenticated', 'public.record_payouts(uuid)', 'execute')
     or has_function_privilege('anon', 'public.record_payouts(uuid)', 'execute') then
    raise exception 'FAIL: the app can call record_payouts()';
  end if;
  if exists (select 1 from public.payouts o join ids on ids.id = o.challenge_id) then
    raise exception 'FAIL: running challenges already have payouts';
  end if;
end $$;

-- As B, within 24 hours of pledging: B's Work out pledge goes to the charity, then back to the reward. Both allowed.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b7","role":"authenticated"}', true);
update public.pledges set to_charity_on_finish = true where challenge_id = (select id from ids where habit_id = 'workout');
update public.pledges set to_charity_on_finish = false where challenge_id = (select id from ids where habit_id = 'workout');
do $$
begin
  if (select to_charity_on_finish from public.pledges where challenge_id = (select id from ids where habit_id = 'workout')) then
    raise exception 'FAIL: B couldn''t switch back to the reward within 24 hours';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- B's Journal pledge was paid 25 hours ago: its choice is fixed, though Journal is still running.
update public.pledges set created_at = now() - interval '25 hours' where challenge_id = (select id from ids where habit_id = 'journal');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b7","role":"authenticated"}', true);
do $$
begin
  begin
    update public.pledges set to_charity_on_finish = false where challenge_id = (select id from ids where habit_id = 'journal');
    raise exception 'FAIL: B changed where a pledge goes more than 24 hours after paying';
  exception when raise_exception then
    if sqlerrm <> 'pledge_choice_fixed' then raise; end if;
  end;
  if (select string_agg(right(challenge_id::text, 0) || choice_open::text, ',' order by choice_open) from public.my_pledges()) is distinct from 'false,true,true' then
    raise exception 'FAIL: my_pledges() says the choice is open on %', (select string_agg(habit || ' ' || choice_open, ', ') from public.my_pledges());
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- The owner records the endings: Work out finished, Read not finished, Journal cancelled.
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() where id = (select id from ids where habit_id = 'workout');
update public.challenges set outcome = 'not_finished', ended_on_day = 5, ended_at = now() where id = (select id from ids where habit_id = 'read');
update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now() where id = (select id from ids where habit_id = 'journal');

do $$
declare
  got text;
  habit_name text;
begin
  -- Finished: the stake back to A, B's pledge to A as the reward; C chose the charity.
  select string_agg(right(user_id::text, 2) || ' ' || right(giver_id::text, 2) || ' ' || source || ' ' || kind || ' ' || amount_cents, ', '
                    order by giver_id, source) into got
    from public.payouts where challenge_id = (select id from ids where habit_id = 'workout');
  if got is distinct from 'a7 a7 stake return 3500, a7 b7 pledge reward 2500' then raise exception 'FAIL: finished challenge paid out %', got; end if;
  select string_agg(right(giver_id::text, 2) || ' ' || source || ' ' || amount_cents, ', ' order by giver_id) into got
    from public.donations where challenge_id = (select id from ids where habit_id = 'workout');
  if got is distinct from 'c7 pledge 2500' then raise exception 'FAIL: finished challenge donated %', got; end if;
  select name into habit_name from public.habits where id = 'workout';
  if exists (select 1 from public.payouts where challenge_id = (select id from ids where habit_id = 'workout')
             and (status <> 'due' or habit is distinct from habit_name)) then
    raise exception 'FAIL: a payout isn''t due, or doesn''t name its habit';
  end if;

  -- Not finished: B's pledge back to B; C's went to the charity with the stake.
  select string_agg(right(user_id::text, 2) || ' ' || right(giver_id::text, 2) || ' ' || source || ' ' || kind || ' ' || amount_cents, ', '
                    order by giver_id, source) into got
    from public.payouts where challenge_id = (select id from ids where habit_id = 'read');
  if got is distinct from 'b7 b7 pledge return 2500' then raise exception 'FAIL: unfinished challenge paid out %', got; end if;

  -- Cancelled: everything back, even a pledge set to the charity both ways.
  select string_agg(right(user_id::text, 2) || ' ' || source || ' ' || kind || ' ' || amount_cents, ', ' order by user_id, source) into got
    from public.payouts where challenge_id = (select id from ids where habit_id = 'journal');
  if got is distinct from 'a7 stake return 2000, b7 pledge return 2500' then raise exception 'FAIL: cancelled challenge paid out %', got; end if;

  -- Every dollar of each stake and its pledges is paid out or donated, never both, never neither.
  if exists (
    select 1 from ids i
    where (select c.stake_cents from public.challenges c where c.id = i.id)
          + (select coalesce(sum(p.amount_cents), 0) from public.pledges p where p.challenge_id = i.id)
       <> (select coalesce(sum(o.amount_cents), 0) from public.payouts o where o.challenge_id = i.id)
          + (select coalesce(sum(d.amount_cents), 0) from public.donations d where d.challenge_id = i.id and d.source in ('stake', 'pledge'))
  ) then
    raise exception 'FAIL: a challenge''s payouts and donations don''t add up to its stake and pledges';
  end if;
end $$;

-- As B, after the end: the choice is fixed.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b7","role":"authenticated"}', true);
do $$
begin
  begin
    update public.pledges set to_charity_on_finish = true where challenge_id = (select id from ids where habit_id = 'workout');
    raise exception 'FAIL: B changed where the pledge goes after the challenge ended';
  exception when raise_exception then
    if sqlerrm <> 'pledge_choice_fixed' then raise; end if;
  end;
  -- B reads only B's own payouts: Read's and Journal's returns.
  if (select string_agg(kind || ' ' || amount_cents, ', ' order by amount_cents) from public.payouts) is distinct from 'return 2500, return 2500' then
    raise exception 'FAIL: B reads payouts %', (select string_agg(kind || ' ' || amount_cents, ', ') from public.payouts);
  end if;
end $$;

-- As A: reads A's own three (two returns and the reward), never whose money the reward was, and can't write any.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a7","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.payouts) <> 3 then raise exception 'FAIL: A reads % payouts, not 3', (select count(*) from public.payouts); end if;
  begin
    perform giver_id from public.payouts;
    raise exception 'FAIL: A read whose money a payout was';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.payouts set amount_cents = 100000;
    raise exception 'FAIL: A changed a payout';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payouts (user_id, source, kind, amount_cents, habit)
      values ('00000000-0000-4000-8000-0000000000a7', 'stake', 'return', 100000, 'Read');
    raise exception 'FAIL: A wrote a payout';
  exception when insufficient_privilege then null;
  end;
end $$;

-- As D, a stranger: nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d7","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.payouts) then raise exception 'FAIL: D reads someone''s payouts'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- Work out's stake is marked sent (T93 will do this), then the owner clears the outcome (an appeal): the
-- sent row stays as it was, the reward that hadn't moved goes.
update public.payouts set status = 'sent' where challenge_id = (select id from ids where habit_id = 'workout') and source = 'stake';
update public.challenges set outcome = null, ended_on_day = null, ended_at = null where id = (select id from ids where habit_id = 'workout');
do $$
declare
  got text;
begin
  select string_agg(source || ' ' || kind || ' ' || status, ', ') into got
    from public.payouts where challenge_id = (select id from ids where habit_id = 'workout');
  if got is distinct from 'stake return sent' then raise exception 'FAIL: after clearing the outcome, payouts are %', got; end if;
end $$;

rollback;

select 'PASS: payouts recorded at the end like payouts() (a finisher''s reward, a pledge chosen for the charity, a failure, a cancel), adding up with the donations; the choice fixed 24 hours after paying; read-only, own-only, givers hidden; a sent payout never changed' as result;
