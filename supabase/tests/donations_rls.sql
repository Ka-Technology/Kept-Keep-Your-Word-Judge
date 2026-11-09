-- Proves the donation record (migration 0033, T62, SPEC-pledges.md "The donation route"): the
-- database writes one row per giver and source when a challenge ends, the same rows as donations()
-- in challenge-rules.ts (v2's worked example both ways, a donate-anyway pledge turned on after a
-- failure, a gift and its raise, a cancel, an outcome the owner clears and records again); nobody
-- writes a donation from the app; each giver reads only their own; and a giver's record outlives
-- the challenger's account, and a giver's own deletion keeps an unsent donation for the charity without naming them (0089).
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/donations_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A is the challenger; B and C are A's friends who pledge; D is a stranger.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a8', 'donations-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b8', 'donations-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000c8', 'donations-c@kept.test'),
  ('00000000-0000-4000-8000-0000000000d8', 'donations-d@kept.test');

insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a8', 'dn_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000b8', 'dn_test_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000c8', 'dn_test_c', '1990-01-01', 'TX'),
  ('00000000-0000-4000-8000-0000000000d8', 'dn_test_d', '1990-01-01', 'WA');

insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000a8', '00000000-0000-4000-8000-0000000000b8', 'accepted', now()),
  ('00000000-0000-4000-8000-0000000000a8', '00000000-0000-4000-8000-0000000000c8', 'accepted', now());

-- A's challenges, as the owner would make them: Read ($20, the first), Work out ($35, v2's worked
-- example) and Journal ($20), all for the ASPCA.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000a8', 'read', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now());
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  select '00000000-0000-4000-8000-0000000000a8', h, 28, s, 'aspca', 'card', 'America/Los_Angeles', now()
  from (values ('workout', 3500), ('journal', 2000)) as v(h, s);

create temporary table ids on commit drop as
  select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a8';
grant select on ids to authenticated;

-- The pledges: two $25 on Work out; $25 and $10 on Read; $25 "donate either way" on Journal.
insert into public.pledges (challenge_id, pledger_id, amount_cents, donate_if_not_finished)
  select i.id, p.who, p.cents, p.anyway
  from ids i join (values
    ('workout', '00000000-0000-4000-8000-0000000000b8'::uuid, 2500, false),
    ('workout', '00000000-0000-4000-8000-0000000000c8'::uuid, 2500, false),
    ('read',    '00000000-0000-4000-8000-0000000000b8'::uuid, 2500, false),
    ('read',    '00000000-0000-4000-8000-0000000000c8'::uuid, 1000, false),
    ('journal', '00000000-0000-4000-8000-0000000000b8'::uuid, 2500, true)
  ) as p(habit, who, cents, anyway) on p.habit = i.habit_id;

-- Privileges: only reading, and only signed in.
do $$
begin
  if has_table_privilege('anon', 'public.donations', 'select') then
    raise exception 'FAIL: anon can read donations';
  end if;
  if not has_table_privilege('authenticated', 'public.donations', 'select')
     or has_any_column_privilege('authenticated', 'public.donations', 'insert')
     or has_any_column_privilege('authenticated', 'public.donations', 'update')
     or has_table_privilege('authenticated', 'public.donations', 'delete') then
    raise exception 'FAIL: the app can do more than read donations';
  end if;
  if has_function_privilege('authenticated', 'public.record_donations(uuid)', 'execute')
     or has_function_privilege('anon', 'public.record_donations(uuid)', 'execute') then
    raise exception 'FAIL: the app can call record_donations()';
  end if;
  if exists (select 1 from public.donations d join ids on ids.id = d.challenge_id) then
    raise exception 'FAIL: running challenges already have donations';
  end if;
end $$;

-- The owner records the endings: Work out finished, Read not finished, Journal cancelled.
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now()
  where id = (select id from ids where habit_id = 'workout');
update public.challenges set outcome = 'not_finished', ended_on_day = 5, ended_at = now()
  where id = (select id from ids where habit_id = 'read');
update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now()
  where id = (select id from ids where habit_id = 'journal');

do $$
declare
  got text;
begin
  -- v2's worked example, finished: each $25 pledge to the charity in its pledger's name; the stake goes back.
  select string_agg(right(giver_id::text, 2) || ' ' || source || ' ' || amount_cents, ', ' order by giver_id, source) into got
    from public.donations where challenge_id = (select id from ids where habit_id = 'workout');
  if got is distinct from 'b8 pledge 2500, c8 pledge 2500' then raise exception 'FAIL: finished challenge donated %', got; end if;
  if exists (select 1 from public.donations where challenge_id = (select id from ids where habit_id = 'workout')
             and (charity_id <> 'aspca' or habit is distinct from (select name from public.habits where id = 'workout'))) then
    raise exception 'FAIL: a donation doesn''t name its charity and habit';
  end if;
  -- Not finished: the stake to the charity; the pledges are refunded.
  select string_agg(right(giver_id::text, 2) || ' ' || source || ' ' || amount_cents, ', ' order by giver_id, source) into got
    from public.donations where challenge_id = (select id from ids where habit_id = 'read');
  if got is distinct from 'a8 stake 2000' then raise exception 'FAIL: unfinished challenge donated %', got; end if;
  -- Cancelled: nothing, not even a pledge set to donate either way.
  if exists (select 1 from public.donations where challenge_id = (select id from ids where habit_id = 'journal')) then
    raise exception 'FAIL: a cancelled challenge made a donation';
  end if;
end $$;

-- As C: turns "donate either way" on after Read failed; C's $10 becomes a donation.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c8","role":"authenticated"}', true);
update public.pledges set donate_if_not_finished = true where challenge_id = (select id from ids where habit_id = 'read');

-- As B: a $10 gift on Read, raised to $15 (one row, the new amount). Reads only B's own donations,
-- and can't write any.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b8","role":"authenticated"}', true);
insert into public.extra_gifts (challenge_id, amount_cents) values ((select id from ids where habit_id = 'read'), 1000);
update public.extra_gifts set amount_cents = 1500 where challenge_id = (select id from ids where habit_id = 'read');

do $$
declare
  got text;
begin
  select string_agg(source || ' ' || amount_cents, ', ' order by source, amount_cents) into got from public.donations;
  if got is distinct from 'gift 1500, pledge 2500' then raise exception 'FAIL: B reads donations %', got; end if;
  begin
    insert into public.donations (giver_id, challenge_id, charity_id, source, amount_cents, habit)
      values ('00000000-0000-4000-8000-0000000000b8', (select id from ids where habit_id = 'journal'), 'aspca', 'gift', 100000, 'Read');
    raise exception 'FAIL: B wrote a donation';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.donations set amount_cents = 1;
    raise exception 'FAIL: B changed a donation';
  exception when insufficient_privilege then null;
  end;
end $$;

-- As D, a stranger: nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d8","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.donations) then raise exception 'FAIL: D reads someone''s donations'; end if;
end $$;

-- Read's rows now: A's stake, C's pledge, B's gift.
reset role;
select set_config('request.jwt.claims', '', true);
do $$
declare
  got text;
begin
  select string_agg(right(giver_id::text, 2) || ' ' || source || ' ' || amount_cents, ', ' order by giver_id, source) into got
    from public.donations where challenge_id = (select id from ids where habit_id = 'read');
  if got is distinct from 'a8 stake 2000, b8 gift 1500, c8 pledge 1000' then raise exception 'FAIL: Read donated %', got; end if;
end $$;

-- The owner restores the day that ended Read and clears its outcome (T29), then it finishes: the
-- stake row goes, both pledges and the gift stay or come in.
update public.challenges set outcome = null, ended_on_day = null, ended_at = null where id = (select id from ids where habit_id = 'read');
do $$
begin
  if exists (select 1 from public.donations where challenge_id = (select id from ids where habit_id = 'read')) then
    raise exception 'FAIL: a cleared outcome kept its donations';
  end if;
end $$;
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() where id = (select id from ids where habit_id = 'read');
do $$
declare
  got text;
begin
  select string_agg(right(giver_id::text, 2) || ' ' || source || ' ' || amount_cents, ', ' order by giver_id, source) into got
    from public.donations where challenge_id = (select id from ids where habit_id = 'read');
  if got is distinct from 'b8 gift 1500, b8 pledge 2500, c8 pledge 1000' then raise exception 'FAIL: Read, finished after all, donated %', got; end if;
end $$;

-- A gives $5 on Work out, then deletes their account: A's own donation stays for the charity without A's name
-- (0089), and B's and C's stay on record with the charity and habit, no longer tied to a challenge.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a8","role":"authenticated"}', true);
insert into public.extra_gifts (challenge_id, amount_cents) values ((select id from ids where habit_id = 'workout'), 500);
select public.delete_account();
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  n int;
begin
  if exists (select 1 from public.donations where giver_id = '00000000-0000-4000-8000-0000000000a8') then
    raise exception 'FAIL: A''s donations still name A after A''s account went';
  end if;
  if (select count(*) from public.donations where giver_id is null and amount_cents = 500 and charity_id = 'aspca') <> 1 then
    raise exception 'FAIL: A''s $5 gift didn''t stay for the charity';
  end if;
  select count(*) into n from public.donations
    where giver_id in ('00000000-0000-4000-8000-0000000000b8', '00000000-0000-4000-8000-0000000000c8')
      and challenge_id is null and charity_id = 'aspca' and habit is not null;
  if n <> 5 then raise exception 'FAIL: % of B''s and C''s 5 donations survived A''s account', n; end if;
end $$;

rollback;

select 'PASS: donations recorded at the end like donations() (both outcomes, donate anyway, gifts, a cancel, a cleared outcome), read-only and own-only, and kept when the challenger leaves, with a giver''s own unsent donation staying unnamed' as result;
