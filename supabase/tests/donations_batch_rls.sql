-- Proves the monthly card batch (migration 0089, T167 part 1, plan.md decision 177; SPEC-payments.md "Donations"):
-- a donation is `owed` until the owner gives it; donations_owed() totals what each charity is owed from card money
-- recorded before a date (crypto donations are left out, and so is anything too recent); donation_batch_given()
-- marks a charity's rows given only if they still add up to what the owner gave, needs a receipt, and a second
-- call changes nothing; a given row survives any later change of the ending, while an owed one still follows it;
-- money_reconciliation() counts only what is still owed; a giver who deletes their account leaves their unsent
-- donation behind, without a giver; and the app can call none of the owner's functions.
-- Everything runs in one transaction that is rolled back, so no test data persists. The project may already hold
-- donations, so every total is compared with what was there before.
-- Run: npx supabase db query --linked -f supabase/tests/donations_batch_rls.sql
--   (with 0089 pushed, or applied inside the same transaction: see docs/wiki/Testing.md)
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

do $$
declare
  f text;
begin
  foreach f in array array['public.donations_owed(date)', 'public.card_donations_owed(date)', 'public.donation_batch_given(text, date, date, text, bigint)'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'FAIL: the app can call %', f;
    end if;
  end loop;
  foreach f in array array['public.donations_owed(date)', 'public.donation_batch_given(text, date, date, text, bigint)'] loop
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'FAIL: the server can''t call %', f; end if;
  end loop;
end $$;

-- What the project already owes, and what the books already say.
create temporary table base on commit drop as
  select
    (select coalesce(sum(amount_cents), 0) from public.donations_owed(current_date + 1) where charity_id = 'aspca') as aspca,
    (select coalesce(sum(amount_cents), 0) from public.donations_owed(current_date + 1) where charity_id = 'feeding-america') as fa,
    (select coalesce(sum(amount_cents), 0) from public.donations_owed(current_date) where charity_id in ('aspca', 'feeding-america')) as today,
    (select donations_cents from public.money_reconciliation()) as books;

-- A is the challenger; B pledges to A's Read.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ae', 'batch-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000be', 'batch-b@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000ae', 'bt_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000be', 'bt_test_b', '1990-01-01', 'CA');
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000ae', '00000000-0000-4000-8000-0000000000be', 'accepted', now());

-- Read ($20, ASPCA, card), Work out ($35, Feeding America, card) and Journal ($20, ASPCA, paid in USDC).
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000ae', 'read', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now()),
         ('00000000-0000-4000-8000-0000000000ae', 'workout', 28, 3500, 'feeding-america', 'card', 'America/Los_Angeles', now());
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_token, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000ae', 'journal', 28, 2000, 'aspca', 'solana_usdc', 'USDC', 'America/Los_Angeles', now());
create temporary table ids on commit drop as
  select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000ae';
grant select on ids to authenticated;

insert into public.pledges (challenge_id, pledger_id, amount_cents, donate_if_not_finished)
  values ((select id from ids where habit_id = 'read'), '00000000-0000-4000-8000-0000000000be', 2500, true);
select public.solana_payment_confirmed(p.id, 'sig-batch-journal', 'wallet-batch-a')
  from public.solana_payments p join ids on ids.id = p.challenge_id where ids.habit_id = 'journal';

-- Nothing is owed while the challenges run.
do $$
begin
  if exists (select 1 from public.donations d join ids on ids.id = d.challenge_id) then
    raise exception 'FAIL: running challenges already owe donations';
  end if;
end $$;

-- None finishes: A's three stakes and B's "donate either way" pledge are donations, all owed.
update public.challenges set outcome = 'not_finished', ended_on_day = 5, ended_at = now() where id in (select id from ids);
do $$
begin
  if (select count(*) from public.donations d join ids on ids.id = d.challenge_id) <> 4
     or exists (select 1 from public.donations d join ids on ids.id = d.challenge_id where d.status <> 'owed' or d.given_on is not null or d.receipt is not null) then
    raise exception 'FAIL: the endings didn''t record 4 owed donations';
  end if;
end $$;

-- The batch covers card money only (Journal was paid in USDC) and nothing recorded today.
do $$
declare
  b base;
begin
  select * into b from base;
  if (select coalesce(sum(amount_cents), 0) from public.donations_owed(current_date + 1) where charity_id = 'aspca') <> b.aspca + 4500 then
    raise exception 'FAIL: ASPCA owes %, expected the card stake and pledge only', (select coalesce(sum(amount_cents), 0) from public.donations_owed(current_date + 1) where charity_id = 'aspca') - b.aspca;
  end if;
  if (select coalesce(sum(amount_cents), 0) from public.donations_owed(current_date + 1) where charity_id = 'feeding-america') <> b.fa + 3500 then
    raise exception 'FAIL: Feeding America doesn''t owe the Work out stake';
  end if;
  if (select coalesce(sum(amount_cents), 0) from public.donations_owed(current_date) where charity_id in ('aspca', 'feeding-america')) <> b.today then
    raise exception 'FAIL: the batch includes donations recorded today';
  end if;
  if (select donations_cents from public.money_reconciliation()) <> b.books + 10000 then
    raise exception 'FAIL: the books don''t count all 4 owed donations ($100)';
  end if;
end $$;

-- The owner gives ASPCA's $45 (plus whatever it was already owed) on 2026-12-01 and records it.
do $$
declare
  b base;
  owed bigint;
  n int;
begin
  select * into b from base;
  owed := b.aspca + 4500;
  begin
    perform public.donation_batch_given('aspca', current_date + 1, date '2026-12-01', '  ', owed);
    raise exception 'FAIL: a batch was recorded without a receipt';
  exception when others then
    if sqlerrm <> 'batch_needs_a_receipt' then raise; end if;
  end;
  begin
    perform public.donation_batch_given('aspca', current_date + 1, date '2026-12-01', 'EO-1', owed - 1);
    raise exception 'FAIL: a batch was recorded for a different amount';
  exception when others then
    if sqlerrm not like 'batch_changed%' then raise; end if;
  end;
  if exists (select 1 from public.donations where status = 'given') then raise exception 'FAIL: a refused batch still marked rows'; end if;

  n := public.donation_batch_given('aspca', current_date + 1, date '2026-12-01', ' EO-1 ', owed);
  if n < 2 then raise exception 'FAIL: the batch marked % rows', n; end if;
  if (select count(*) from public.donations d join ids on ids.id = d.challenge_id
      where d.status = 'given' and d.given_on = date '2026-12-01' and d.receipt = 'EO-1' and d.charity_id = 'aspca') <> 2 then
    raise exception 'FAIL: Read''s two donations aren''t given with the day and the receipt';
  end if;
  -- Journal (crypto) and Work out (another charity) are still owed.
  if (select count(*) from public.donations d join ids on ids.id = d.challenge_id where d.status = 'owed') <> 2 then
    raise exception 'FAIL: the batch marked the crypto donation or another charity''s';
  end if;
  -- A second call changes nothing.
  begin
    perform public.donation_batch_given('aspca', current_date + 1, date '2026-12-01', 'EO-1', owed);
    raise exception 'FAIL: the same batch was recorded twice';
  exception when others then
    if sqlerrm not like 'batch_changed%' then raise; end if;
  end;
  if (select coalesce(sum(amount_cents), 0) from public.donations_owed(current_date + 1) where charity_id = 'aspca') <> 0 then
    raise exception 'FAIL: ASPCA still owes after it was given';
  end if;
  -- The books drop by exactly what left.
  if (select donations_cents from public.money_reconciliation()) <> b.books + 10000 - owed then
    raise exception 'FAIL: the books didn''t drop by what was given';
  end if;
end $$;

-- A given row is never changed by the ending: the owner clears Read's outcome and records it again, and the two
-- given rows stay; Work out's owed row goes with its cleared outcome, and comes back with it.
update public.challenges set outcome = null, ended_on_day = null, ended_at = null where id in (select id from ids where habit_id in ('read', 'workout'));
do $$
begin
  if (select count(*) from public.donations d join ids on ids.id = d.challenge_id where d.status = 'given') <> 2 then
    raise exception 'FAIL: a cleared outcome removed a given donation';
  end if;
  if exists (select 1 from public.donations d join ids on ids.id = d.challenge_id where ids.habit_id = 'workout') then
    raise exception 'FAIL: a cleared outcome kept an owed donation';
  end if;
end $$;
update public.challenges set outcome = 'finished', ended_on_day = 28, ended_at = now() where id = (select id from ids where habit_id = 'read');
do $$
begin
  if (select count(*) from public.donations d join ids on ids.id = d.challenge_id
      where d.status = 'given' and d.receipt = 'EO-1' and d.amount_cents in (2000, 2500)) <> 2 then
    raise exception 'FAIL: a new ending changed a given donation';
  end if;
end $$;
update public.challenges set outcome = 'not_finished', ended_on_day = 5, ended_at = now() where id = (select id from ids where habit_id = 'workout');

-- As A: sees their donation as given, with the day, and can't change it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000ae","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.donations where status = 'given' and given_on = date '2026-12-01') <> 1 then
    raise exception 'FAIL: A doesn''t read their given donation';
  end if;
  begin
    update public.donations set status = 'given', given_on = current_date, receipt = 'fake';
    raise exception 'FAIL: A marked a donation given';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.donations_owed(current_date + 1);
    raise exception 'FAIL: A read what the charities are owed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A deletes their account: Work out's unsent donation stays for the charity, without a giver.
select public.delete_account();
reset role;
select set_config('request.jwt.claims', '', true);
do $$
declare
  b base;
begin
  select * into b from base;
  if (select coalesce(sum(amount_cents), 0) from public.donations_owed(current_date + 1) where charity_id = 'feeding-america') <> b.fa + 3500 then
    raise exception 'FAIL: Feeding America lost its donation when A deleted their account';
  end if;
  if exists (select 1 from public.donations where giver_id = '00000000-0000-4000-8000-0000000000ae') then
    raise exception 'FAIL: A''s donations still name A';
  end if;
end $$;

rollback;

select 'PASS: the card batch totals owed donations (card money only, not too recent), records a gift only for the amount given and with a receipt, never twice, leaves a given row alone, and the books and a deleted account follow' as result;
