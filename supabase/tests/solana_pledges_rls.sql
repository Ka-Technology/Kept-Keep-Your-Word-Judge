-- Proves Solana S4's database side (migration 0073, T171): a pledge on a crypto challenge is paid up front from
-- the pledger's wallet, in the challenger's token (start_crypto_pledge(), checked like any pledge), and counts
-- only once paid; a raise pays the difference; a pledge that breaks a rule by the time it's paid goes back whole.
-- At the end each pledge payment becomes a payout by Kept's rules: on a finish, a `reward` to the challenger's
-- wallet, or a `donation` if its pledger chose the charity; on a failure, a `return` to the pledger's wallet
-- unless they chose to donate either way; on a cancel, a `return`. A pledge withdrawn by the end of Day 1 goes
-- back too. Kept's fee never moves. A card challenge takes no crypto pledges.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/solana_pledges_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A is the challenger; B and D are A's friends.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ad', 'sol-pl-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000bd', 'sol-pl-b@kept.test'),
  ('00000000-0000-4000-8000-0000000000dd', 'sol-pl-d@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000ad', 'sp_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000bd', 'sp_test_b', '1990-01-01', 'CA'),
  ('00000000-0000-4000-8000-0000000000dd', 'sp_test_d', '1990-01-01', 'TX');
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000ad', '00000000-0000-4000-8000-0000000000bd', 'accepted', now()),
  ('00000000-0000-4000-8000-0000000000ad', '00000000-0000-4000-8000-0000000000dd', 'accepted', now());

-- A's four $20 USDC challenges, paid from wallet-a, and a card one.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_token, time_zone, consented_at)
select '00000000-0000-4000-8000-0000000000ad', h, 28, 2000, 'aspca', 'solana_usdc', 'USDC', 'America/Los_Angeles', now()
from unnest(array['workout', 'read', 'cook', 'journal']) h;
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000ad', 'stretch', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now());
create temporary table ids on commit drop as
  select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000ad';
grant select on ids to authenticated;
select public.solana_payment_confirmed(p.id, 'sig-stake-' || c.habit_id, 'wallet-a')
from public.solana_payments p join ids c on c.id = p.challenge_id;

do $$
begin
  if has_function_privilege('anon', 'public.start_crypto_pledge(uuid, integer, boolean, boolean)', 'execute') then
    raise exception 'FAIL: anon can start a crypto pledge';
  end if;
end $$;

-- As B: $25 on Work out (the reward), $20 on Read, $10 on Cook and $10 on Journal.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000bd","role":"authenticated"}', true);
create temporary table b_pay (habit_id text, payment uuid) on commit drop;
grant all on b_pay to authenticated;
insert into b_pay select 'workout', public.start_crypto_pledge((select id from ids where habit_id = 'workout'), 2500, false, false);
insert into b_pay select 'read', public.start_crypto_pledge((select id from ids where habit_id = 'read'), 2000, false, false);
insert into b_pay select 'cook', public.start_crypto_pledge((select id from ids where habit_id = 'cook'), 1000, false, false);
insert into b_pay select 'journal', public.start_crypto_pledge((select id from ids where habit_id = 'journal'), 1000, false, false);

do $$
begin
  if exists (select 1 from public.pledges) then raise exception 'FAIL: a crypto pledge counted before it was paid'; end if;
  if (select kind || ' ' || token || ' ' || stake_cents || ' ' || fee_cents || ' ' || status from public.solana_payments where id = (select payment from b_pay where habit_id = 'workout'))
     is distinct from 'pledge USDC 2500 225 awaiting' then
    raise exception 'FAIL: the pledge payment isn''t priced in the challenger''s token';
  end if;
  begin
    perform public.start_crypto_pledge((select id from ids where habit_id = 'stretch'), 2500, false, false);
    raise exception 'FAIL: a card challenge took a crypto pledge';
  exception when raise_exception then
    if sqlerrm <> 'pledge_crypto_challenge_only' then raise; end if;
  end;
  begin
    perform public.start_crypto_pledge((select id from ids where habit_id = 'workout'), 10100, false, false);
    raise exception 'FAIL: a crypto pledge skipped the pledge rules';
  exception when check_violation then
    null;
  end;
end $$;

-- B's wallet pays all four.
reset role;
select set_config('request.jwt.claims', '', true);
select public.solana_payment_confirmed(payment, 'sig-pledge-' || habit_id, 'wallet-b') from b_pay;

do $$
begin
  if (select string_agg(c.habit_id || ' ' || p.amount_cents, ', ' order by c.habit_id) from public.pledges p join ids c on c.id = p.challenge_id)
     is distinct from 'cook 1000, journal 1000, read 2000, workout 2500' then
    raise exception 'FAIL: paid crypto pledges didn''t count';
  end if;
end $$;

-- B raises Work out to $30 (pays $5 and the $0.15 more fee); D pledges $20 on it for the charity.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000bd","role":"authenticated"}', true);
insert into b_pay select 'raise', public.start_crypto_pledge((select id from ids where habit_id = 'workout'), 3000, false, false);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000dd","role":"authenticated"}', true);
insert into b_pay select 'd', public.start_crypto_pledge((select id from ids where habit_id = 'workout'), 2000, false, true);
reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if (select stake_cents || ' ' || fee_cents from public.solana_payments where id = (select payment from b_pay where habit_id = 'raise')) <> '500 15' then
    raise exception 'FAIL: a raise isn''t priced as the difference';
  end if;
end $$;
select public.solana_payment_confirmed((select payment from b_pay where habit_id = 'raise'), 'sig-raise', 'wallet-b');
select public.solana_payment_confirmed((select payment from b_pay where habit_id = 'd'), 'sig-d', 'wallet-d');

-- B withdraws Journal's pledge on Day 0: its $10 goes back to wallet-b, the fee stays.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000bd","role":"authenticated"}', true);
delete from public.pledges where challenge_id = (select id from ids where habit_id = 'journal');
reset role;
select set_config('request.jwt.claims', '', true);

-- Work out finishes, Read doesn't, Cook is cancelled.
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() where id = (select id from ids where habit_id = 'workout');
update public.challenges set outcome = 'not_finished', ended_on_day = 9, ended_at = now() where id = (select id from ids where habit_id = 'read');
update public.challenges set outcome = 'cancelled', ended_on_day = 0, ended_at = now() where id = (select id from ids where habit_id = 'cook');

do $$
declare
  got text;
begin
  select string_agg(c.habit_id || ' ' || o.kind || ' ' || o.amount_cents || ' to ' || coalesce(o.to_wallet, '-') || ' for ' || pr.username, ', '
                    order by c.habit_id, o.kind, o.amount_cents)
    into got
    from public.solana_payouts o join public.solana_payments p on p.id = o.payment_id join ids c on c.id = o.challenge_id
    join public.profiles pr on pr.id = o.user_id
    where p.kind = 'pledge';
  if got is distinct from 'cook return 1000 to wallet-b for sp_test_b, journal return 1000 to wallet-b for sp_test_b, '
                          'read return 2000 to wallet-b for sp_test_b, workout donation 2000 to - for sp_test_d, '
                          'workout reward 500 to wallet-a for sp_test_a, workout reward 2500 to wallet-a for sp_test_a' then
    raise exception 'FAIL: the pledge payouts are %', got;
  end if;

  -- A pledge paid after its challenge ended goes back whole, fee too.
  insert into public.solana_payments (user_id, challenge_id, kind, token, stake_cents, fee_cents, pledge)
    values ('00000000-0000-4000-8000-0000000000dd', (select id from ids where habit_id = 'read'), 'pledge', 'USDC', 1000, 180,
            '{"amount_cents": 1000, "raise": false, "donate_if_not_finished": false, "to_charity_on_finish": false}');
  perform public.solana_payment_confirmed((select id from public.solana_payments where signature is null and user_id = '00000000-0000-4000-8000-0000000000dd'), 'sig-late', 'wallet-d');
  if (select kind || ' ' || amount_cents || ' to ' || to_wallet from public.solana_payouts where payment_id = (select id from public.solana_payments where signature = 'sig-late'))
     is distinct from 'return 1180 to wallet-d' then
    raise exception 'FAIL: a pledge that couldn''t count wasn''t sent back whole';
  end if;
end $$;

rollback;

select 'PASS: crypto pledges paid up front in the challenger''s token, counted once paid, raised by the difference; at the end a reward, donation or return by Kept''s rules, a withdrawal returned, the fee kept; card challenges take none' as result;
