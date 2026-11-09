-- Proves card charges up front (migration 0061, T93, plan.md decision 142): a card challenge signed with
-- `pay_card` waits for its payment, with a charge priced by the database (the stake plus its fee); a paid
-- charge counts once, a failed one removes the unpaid challenge, and one left pending 30 minutes expires.
-- A pledge is checked as the pledger without being saved (check_pledge()), priced as a new pledge or a
-- raise (pledge_charge()), and saved only once paid, with the pledger's choices; a pledge that broke a rule
-- meanwhile is answered 'refund'. Refunds never pass the total. Users read only their own charges and write
-- none, and only the server can move a charge.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked --project-ref <ref> -f supabase/tests/charges_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A is the challenger; B is A's friend; D is a stranger.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a6', 'charges-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b6', 'charges-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000d6', 'charges-d@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a6', 'ch_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000b6', 'ch_test_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000d6', 'ch_test_d', '1990-01-01', 'WA');
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000a6', '00000000-0000-4000-8000-0000000000b6', 'accepted', now());

-- Privileges first.
do $$
begin
  if has_table_privilege('anon', 'public.charges', 'select') then raise exception 'FAIL: anon can read charges'; end if;
  if has_any_column_privilege('authenticated', 'public.charges', 'insert')
     or has_any_column_privilege('authenticated', 'public.charges', 'update')
     or has_table_privilege('authenticated', 'public.charges', 'delete') then
    raise exception 'FAIL: the app can write charges';
  end if;
  if has_function_privilege('authenticated', 'public.card_charge_succeeded(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.card_charge_failed(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.pledge_charge(uuid, uuid, integer, boolean, boolean, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.card_refunded(uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.card_charges_expire()', 'execute') then
    raise exception 'FAIL: the app can move a charge';
  end if;
  if not has_function_privilege('authenticated', 'public.check_pledge(uuid, integer)', 'execute')
     or has_function_privilege('anon', 'public.check_pledge(uuid, integer)', 'execute') then
    raise exception 'FAIL: check_pledge() isn''t for signed-in users only';
  end if;
end $$;

-- A's challenges, as the app signs them: a pretend one first (the $25 first-challenge cap), then three card
-- ones charged up front: Work out ($35), Journal ($20) and Meditate ($20).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a6","role":"authenticated"}', true);
insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('read', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now());
insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
  select h, 28, s, 'aspca', 'card', true, 'America/Los_Angeles', now()
  from (values ('workout', 3500), ('journal', 2000), ('meditate', 2000)) as v(h, s);
do $$
begin
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
      values ('cook', 28, 2000, 'aspca', 'solana_usdc', true, 'America/Los_Angeles', now());
    raise exception 'FAIL: a Solana challenge was signed to be charged by card';
  exception when check_violation then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

create temporary table ids on commit drop as
  select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000a6';
grant select on ids to authenticated;

do $$
declare
  got text;
begin
  -- Each card challenge waits, with one pending charge priced by the database; the pretend one has none.
  select string_agg(i.habit_id || ' ' || coalesce(c.payment_status, '-') || ' ' || coalesce(ch.kind || ' ' || ch.amount_cents || '+' || ch.fee_cents || '=' || ch.total_cents || ' ' || ch.status, 'none'), ', ' order by i.habit_id)
    into got
    from ids i join public.challenges c on c.id = i.id left join public.charges ch on ch.challenge_id = i.id;
  if got is distinct from 'journal awaiting stake 2000+210=2210 pending, meditate awaiting stake 2000+210=2210 pending, read - none, workout awaiting stake 3500+255=3755 pending' then
    raise exception 'FAIL: card challenges and their charges are %', got;
  end if;
end $$;

-- Work out is paid: it counts, once.
do $$
declare
  charge uuid := (select id from public.charges where challenge_id = (select id from ids where habit_id = 'workout'));
begin
  if public.card_charge_succeeded(charge, 'pi_test_workout') <> 'paid' then raise exception 'FAIL: a paid stake wasn''t paid'; end if;
  if public.card_charge_succeeded(charge, 'pi_test_workout') <> 'already' then raise exception 'FAIL: a stake was paid twice'; end if;
  if (select payment_status from public.challenges where id = (select id from ids where habit_id = 'workout')) <> 'paid' then
    raise exception 'FAIL: the paid challenge still waits';
  end if;
end $$;

-- Journal's card is declined: the unpaid challenge goes. Meditate is left pending for 31 minutes: it expires,
-- and money arriving after that is answered 'refund'.
select public.card_charge_failed((select id from public.charges where challenge_id = (select id from ids where habit_id = 'journal')), 'Your card was declined.');
update public.charges set created_at = now() - interval '31 minutes' where challenge_id = (select id from ids where habit_id = 'meditate');
create temporary table meditate_charge on commit drop as
  select id from public.charges where challenge_id = (select id from ids where habit_id = 'meditate');
select public.card_charges_expire();
do $$
begin
  if exists (select 1 from public.challenges where id = (select id from ids where habit_id = 'journal')) then
    raise exception 'FAIL: a declined card left its unpaid challenge';
  end if;
  if (select status from public.charges where id = (select id from meditate_charge)) <> 'expired'
     or exists (select 1 from public.challenges where id = (select id from ids where habit_id = 'meditate')) then
    raise exception 'FAIL: a charge pending 30 minutes didn''t expire with its challenge';
  end if;
  if public.card_charge_succeeded((select id from meditate_charge), 'pi_test_late') <> 'refund' then
    raise exception 'FAIL: money for an expired challenge wasn''t answered refund';
  end if;
end $$;

-- As B: checks a $25 pledge on Work out (nothing is saved), and a pledge past the $300 limit is refused.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b6","role":"authenticated"}', true);
select public.check_pledge((select id from ids where habit_id = 'workout'), 2500);
do $$
begin
  if exists (select 1 from public.pledges) then raise exception 'FAIL: check_pledge() saved a pledge'; end if;
  begin
    perform public.check_pledge((select id from ids where habit_id = 'workout'), 40000);
    raise exception 'FAIL: check_pledge() passed a pledge the database refuses';
  exception when others then
    if sqlerrm not like '%pledge%' and sqlerrm not like '%check%' then raise; end if;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

-- As D, a stranger: a private challenge can't be backed.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d6","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.check_pledge((select id from ids where habit_id = 'workout'), 2500);
    raise exception 'FAIL: a stranger''s pledge passed the check';
  exception when raise_exception then
    if sqlerrm <> 'pledge_not_friend' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- The server prices and saves B's pledge once paid ($25, set to the charity if A finishes), then a raise to $40
-- (the extra $15 and the fee's difference). D's charge, for a pledge D can't make, is answered 'refund'.
do $$
declare
  ch public.charges;
begin
  ch := public.pledge_charge('00000000-0000-4000-8000-0000000000b6', (select id from ids where habit_id = 'workout'), 2500, false, true);
  if ch.amount_cents <> 2500 or ch.fee_cents <> 225 or ch.total_cents <> 2725 or ch.status <> 'pending' then
    raise exception 'FAIL: a new pledge was priced %+%', ch.amount_cents, ch.fee_cents;
  end if;
  if exists (select 1 from public.pledges) then raise exception 'FAIL: a pledge was saved before it was paid'; end if;
  if public.card_charge_succeeded(ch.id, 'pi_test_pledge') <> 'paid' then raise exception 'FAIL: a paid pledge wasn''t saved'; end if;
  if (select amount_cents::text || ' ' || to_charity_on_finish || ' ' || donate_if_not_finished || ' ' || kind from public.pledges)
     is distinct from '2500 true false supporter' then
    raise exception 'FAIL: the paid pledge isn''t saved with its choices';
  end if;

  ch := public.pledge_charge('00000000-0000-4000-8000-0000000000b6', (select id from ids where habit_id = 'workout'), 4000, false, false);
  if ch.amount_cents <> 1500 or ch.fee_cents <> 45 or ch.pledge->>'raise' <> 'true' then
    raise exception 'FAIL: a raise was priced %+%', ch.amount_cents, ch.fee_cents;
  end if;
  -- The call on its own line: one statement's subqueries would still see the pledge from before it ran.
  if public.card_charge_succeeded(ch.id, 'pi_test_raise') <> 'paid' then raise exception 'FAIL: a paid raise wasn''t paid'; end if;
  if (select amount_cents from public.pledges) <> 4000 or not (select to_charity_on_finish from public.pledges) then
    raise exception 'FAIL: a paid raise didn''t raise the pledge alone';
  end if;
  begin
    perform public.pledge_charge('00000000-0000-4000-8000-0000000000b6', (select id from ids where habit_id = 'workout'), 3000, false, false);
    raise exception 'FAIL: a lower pledge was priced';
  exception when raise_exception then
    if sqlerrm <> 'pledge_only_raise' then raise; end if;
  end;

  ch := public.pledge_charge('00000000-0000-4000-8000-0000000000d6', (select id from ids where habit_id = 'workout'), 2500, false, false);
  if public.card_charge_succeeded(ch.id, 'pi_test_stranger') <> 'refund' then raise exception 'FAIL: a pledge that breaks a rule wasn''t answered refund'; end if;
  if exists (select 1 from public.pledges where pledger_id = '00000000-0000-4000-8000-0000000000d6') then
    raise exception 'FAIL: a pledge that breaks a rule was saved';
  end if;

  -- Refunds add up, and never pass what was charged.
  perform public.card_refunded(ch.id, 2500);
  begin
    perform public.card_refunded(ch.id, 500);
    raise exception 'FAIL: a refund passed the total';
  exception when check_violation then null;
  end;
end $$;

-- As B: reads only B's own charges (the pledge and the raise), and can't write any.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b6","role":"authenticated"}', true);
do $$
begin
  if (select string_agg(kind || ' ' || amount_cents, ', ' order by amount_cents) from public.charges) is distinct from 'pledge 1500, pledge 2500' then
    raise exception 'FAIL: B reads charges %', (select string_agg(kind || ' ' || amount_cents, ', ') from public.charges);
  end if;
  begin
    update public.charges set status = 'succeeded';
    raise exception 'FAIL: B changed a charge';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

rollback;

select 'PASS: card stakes wait for a charge priced by the database, paid once, removed when declined or expired; pledges checked as the pledger, priced new or raised, saved only once paid; refunds within the total; own-only reads, server-only writes' as result;
