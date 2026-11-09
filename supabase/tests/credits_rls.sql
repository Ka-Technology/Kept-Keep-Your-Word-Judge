-- Proves Kept credits spent on the fee (migration 0062, T164): a backer whose challenger finishes earns 10%
-- of each pledge, never more than its fee (creditsFor()); a card charge takes what's left off its fee, never
-- more than the fee; a failed charge, or one refunded whole because nothing was bought, gives its credits
-- back; someone with none pays the whole fee; my_credits() is the caller's own and credit_balance_cents()
-- isn't the app's to call.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked --project-ref <ref> -f supabase/tests/credits_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A is the challenger; B backs A's public challenges as a stranger.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a5', 'credits-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000b5', 'credits-b@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000a5', 'cr_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000b5', 'cr_test_b', '1990-01-01', 'CA');

do $$
begin
  if has_function_privilege('authenticated', 'public.credit_balance_cents(uuid)', 'execute') then
    raise exception 'FAIL: the app can read anyone''s credits';
  end if;
  if not has_function_privilege('authenticated', 'public.my_credits()', 'execute')
     or has_function_privilege('anon', 'public.my_credits()', 'execute') then
    raise exception 'FAIL: my_credits() isn''t for signed-in users only';
  end if;
end $$;

-- A's two public challenges; B backs Read with $25 and Work out with $50, and both finish:
-- B earns $2.25 (10% is $2.50, capped at the $2.25 fee) and $3.00 (10% is $5, capped at the $3.00 fee).
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, is_public)
  values ('00000000-0000-4000-8000-0000000000a5', 'read', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now(), true);
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, is_public)
  values ('00000000-0000-4000-8000-0000000000a5', 'workout', 28, 3500, 'aspca', 'card', 'America/Los_Angeles', now(), true);
insert into public.pledges (challenge_id, pledger_id, amount_cents)
  select c.id, '00000000-0000-4000-8000-0000000000b5', case c.habit_id when 'read' then 2500 else 5000 end
  from public.challenges c where c.user_id = '00000000-0000-4000-8000-0000000000a5';
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now()
  where user_id = '00000000-0000-4000-8000-0000000000a5';

do $$
begin
  if (select string_agg(kind, ',') from public.pledges where pledger_id = '00000000-0000-4000-8000-0000000000b5') <> 'backer,backer' then
    raise exception 'FAIL: B''s pledges aren''t a backer''s';
  end if;
  if public.credit_balance_cents('00000000-0000-4000-8000-0000000000b5') <> 525 then
    raise exception 'FAIL: B earned % in credits, not 525', public.credit_balance_cents('00000000-0000-4000-8000-0000000000b5');
  end if;
  if public.credit_balance_cents('00000000-0000-4000-8000-0000000000a5') <> 0 then raise exception 'FAIL: A has credits without backing anyone'; end if;
end $$;

-- B signs card challenges, as the app does: a $10 Journal (fee $1.80, all of it paid in credits), then a $20
-- Meditate (fee $2.10, of B's $3.45 left).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b5","role":"authenticated"}', true);
insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
  values ('journal', 28, 1000, 'aspca', 'card', true, 'America/Los_Angeles', now());
insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
  values ('meditate', 28, 2000, 'aspca', 'card', true, 'America/Los_Angeles', now());
do $$
begin
  if public.my_credits() <> 135 then raise exception 'FAIL: B has % in credits left, not 135', public.my_credits(); end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

create temporary table b_charges on commit drop as
  select c.habit_id, ch.id, ch.fee_cents, ch.credits_cents, ch.total_cents
  from public.charges ch join public.challenges c on c.id = ch.challenge_id
  where ch.user_id = '00000000-0000-4000-8000-0000000000b5';

do $$
declare
  got text;
begin
  select string_agg(habit_id || ' ' || fee_cents || '-' || credits_cents || '=' || total_cents, ', ' order by habit_id) into got from b_charges;
  if got is distinct from 'journal 180-180=1000, meditate 210-210=2000' then raise exception 'FAIL: B''s charges with credits are %', got; end if;

  -- Meditate's card is declined: its credits come back.
  perform public.card_charge_failed((select id from b_charges where habit_id = 'meditate'), 'Your card was declined.');
  if public.credit_balance_cents('00000000-0000-4000-8000-0000000000b5') <> 345 then
    raise exception 'FAIL: a declined charge kept its credits (% left)', public.credit_balance_cents('00000000-0000-4000-8000-0000000000b5');
  end if;

  -- Journal is paid: its credits stay spent. Then a late payment for a challenge that's gone: refunded whole, credits back.
  perform public.card_charge_succeeded((select id from b_charges where habit_id = 'journal'), 'pi_test_journal');
  if public.credit_balance_cents('00000000-0000-4000-8000-0000000000b5') <> 345 then raise exception 'FAIL: a paid charge''s credits moved'; end if;
  delete from public.challenges where habit_id = 'journal' and user_id = '00000000-0000-4000-8000-0000000000b5';
end $$;

-- A charge for nothing: a Walk challenge removed before its money arrives.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000b5', 'cook', 28, 2000, 'aspca', 'card', true, 'America/Los_Angeles', now());
do $$
declare
  charge uuid := (select ch.id from public.charges ch join public.challenges c on c.id = ch.challenge_id where c.habit_id = 'cook' and c.user_id = '00000000-0000-4000-8000-0000000000b5');
begin
  if public.credit_balance_cents('00000000-0000-4000-8000-0000000000b5') <> 135 then raise exception 'FAIL: Cook didn''t take its credits'; end if;
  delete from public.challenges where habit_id = 'cook' and user_id = '00000000-0000-4000-8000-0000000000b5';
  if public.card_charge_succeeded(charge, 'pi_test_cook') <> 'refund' then raise exception 'FAIL: money for a removed challenge wasn''t answered refund'; end if;
  if public.credit_balance_cents('00000000-0000-4000-8000-0000000000b5') <> 345 then
    raise exception 'FAIL: a charge refunded whole kept its credits (% left)', public.credit_balance_cents('00000000-0000-4000-8000-0000000000b5');
  end if;
end $$;

-- A, with no credits, pays the whole fee.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000a5', 'journal', 28, 3500, 'aspca', 'card', true, 'America/Los_Angeles', now());
do $$
begin
  if (select ch.credits_cents::text || ' ' || ch.total_cents from public.charges ch join public.challenges c on c.id = ch.challenge_id
      where c.user_id = '00000000-0000-4000-8000-0000000000a5' and c.habit_id = 'journal') is distinct from '0 3755' then
    raise exception 'FAIL: someone with no credits didn''t pay the whole fee';
  end if;
end $$;

rollback;

select 'PASS: backers earn credits capped at each fee; a charge takes them off its fee and never more; a declined or refunded-whole charge gives them back; my_credits() own-only' as result;
