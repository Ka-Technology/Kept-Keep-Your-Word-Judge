-- Proves migration 0082 (T203, plan.md decision 171): a challenge signed in the app keeps its signature, the
-- signer's full name from their profile, the time and the text signed, in challenge_signatures; only the signer
-- reads it (not a friend who can read the challenge, not anon); nobody writes or changes it directly; a malformed
-- signature, or one from an account with no name on file, stops the whole challenge; and a challenge sent
-- without one (older builds) is still taken.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/signatures_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- S signs; F is S's friend; N has no name on file (an account from before decision 100).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000005a1', 'sign-s@kept.test'),
  ('00000000-0000-4000-8000-0000000005a2', 'sign-f@kept.test'),
  ('00000000-0000-4000-8000-0000000005a3', 'sign-n@kept.test');

insert into public.profiles (id, username, date_of_birth, state_code, first_name, last_name) values
  ('00000000-0000-4000-8000-0000000005a1', 'sign_test_s', '1990-01-01', 'OR', 'Sam', 'Signer'),
  ('00000000-0000-4000-8000-0000000005a2', 'sign_test_f', '1990-01-01', 'OR', 'Frankie', 'Friend'),
  ('00000000-0000-4000-8000-0000000005a3', 'sign_test_n', '1990-01-01', 'OR', null, null);

insert into public.friendships (requester_id, addressee_id, status, accepted_at)
values ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005a2', 'accepted', now());

create temporary table signed (habit text, id uuid) on commit drop;
grant select, insert on signed to authenticated;

-- As S
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000005a1","role":"authenticated"}', true);

do $$
declare
  row public.challenge_signatures;
  cid uuid;
  n int;
begin
  -- Drawn. A name sent by the app is ignored: the profile's is used.
  insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, signature)
    values ('read', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now(),
            '{"kind":"drawn","strokes":"M0 0L150 50L300 100M5.5 5L5.5 5","contract_text":"I, Sam Signer, commit to “Read”…","signed_name":"Someone Else"}')
    returning challenges.id into cid;
  insert into signed values ('read', cid);
  select * into row from public.challenge_signatures s where s.challenge_id = cid;
  if row is null then raise exception 'FAIL: a drawn signature wasn''t kept'; end if;
  if row.signed_name <> 'Sam Signer' then raise exception 'FAIL: signed as %, not the profile''s name', row.signed_name; end if;
  if row.kind <> 'drawn' or row.strokes <> 'M0 0L150 50L300 100M5.5 5L5.5 5' or row.contract_text <> 'I, Sam Signer, commit to “Read”…' then
    raise exception 'FAIL: the drawn signature changed on the way in';
  end if;
  if row.user_id <> '00000000-0000-4000-8000-0000000005a1' or row.signed_at <> now() then raise exception 'FAIL: wrong signer or time'; end if;
  if (select c.signature from public.challenges c where c.id = cid) is not null then raise exception 'FAIL: the signature stayed on the challenge'; end if;

  -- Adopted: no strokes.
  insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, signature)
    values ('workout', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now(), '{"kind":"adopted","contract_text":"I, Sam Signer, commit to “Work out”…"}')
    returning challenges.id into cid;
  insert into signed values ('workout', cid);
  if (select s.kind from public.challenge_signatures s where s.challenge_id = cid) is distinct from 'adopted' then
    raise exception 'FAIL: an adopted signature wasn''t kept';
  end if;
end $$;

-- The foreign key waits for the end of the transaction; check it now that both challenges exist, then let it
-- wait again (checked at once, it would fire inside the trigger, before its challenge is written).
set constraints public.challenge_signatures_challenge_id_fkey immediate;
set constraints public.challenge_signatures_challenge_id_fkey deferred;

-- Each malformed signature, as S: refused, and no challenge is left behind.
do $$
declare
  bad jsonb;
begin
  foreach bad in array array[
    '{"kind":"drawn","contract_text":"x"}',
    '{"kind":"adopted","strokes":"M0 0L1 1","contract_text":"x"}',
    '{"kind":"drawn","strokes":"<svg onload=alert(1)>","contract_text":"x"}',
    '{"kind":"drawn","strokes":"M0 0L1 1 Z","contract_text":"x"}',
    '{"kind":"typed","contract_text":"x"}',
    '{"kind":"adopted","contract_text":""}'
  ]::jsonb[] || jsonb_build_object('kind', 'drawn', 'contract_text', 'x', 'strokes', 'M0 0' || repeat('L1 1', 5000)) loop
    begin
      insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, signature)
        values ('walk-run', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now(), bad);
      raise exception 'FAIL: a malformed signature was taken: %', bad;
    exception when check_violation or not_null_violation then null;
    end;
  end loop;
  if exists (select 1 from public.challenges c where c.habit_id = 'walk-run') then raise exception 'FAIL: a refused signature left its challenge'; end if;

  -- An unsigned challenge (an older build) is still taken, with nothing to keep.
  insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
    values ('walk-run', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now());
  if exists (select 1 from public.challenge_signatures s join public.challenges c on c.id = s.challenge_id where c.habit_id = 'walk-run') then
    raise exception 'FAIL: an unsigned challenge got a signature';
  end if;

  -- The signer can't write or change a signature themselves.
  begin
    insert into public.challenge_signatures (challenge_id, user_id, kind, signed_name, contract_text)
      values ((select id from signed where habit = 'read'), '00000000-0000-4000-8000-0000000005a1', 'adopted', 'Sam Signer', 'x');
    raise exception 'FAIL: a signature was written directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.challenge_signatures set signed_name = 'Someone Else';
    raise exception 'FAIL: a signature was changed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.challenge_signatures;
    raise exception 'FAIL: a signature was deleted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- As F, S's friend: S's challenges are readable, their signatures aren't.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000005a2","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.challenges c where c.user_id = '00000000-0000-4000-8000-0000000005a1') < 2 then
    raise exception 'FAIL: the friend can''t read the challenges (the setup is wrong)';
  end if;
  if exists (select 1 from public.challenge_signatures) then raise exception 'FAIL: a friend read a signature'; end if;
end $$;

-- As N, with no name on file: signing is refused, and nothing is left.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000005a3","role":"authenticated"}', true);
do $$
begin
  begin
    insert into public.challenges (habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, signature)
      values ('read', 28, 1000, 'aspca', 'card', 'America/Los_Angeles', now(), '{"kind":"adopted","contract_text":"x"}');
    raise exception 'FAIL: a signature without a name was taken';
  exception when check_violation then
    if sqlerrm <> 'name_required' then raise; end if;
  end;
  if exists (select 1 from public.challenges c where c.user_id = '00000000-0000-4000-8000-0000000005a3') then
    raise exception 'FAIL: a refused signature left its challenge';
  end if;
end $$;

-- anon reads nothing.
reset role;
set local role anon;
do $$
begin
  perform 1 from public.challenge_signatures;
  raise exception 'FAIL: anon read challenge_signatures';
exception when insufficient_privilege then null;
end $$;

-- A deleted challenge takes its signature with it.
reset role;
do $$
begin
  delete from public.challenges c where c.id = (select id from signed where habit = 'read');
  if exists (select 1 from public.challenge_signatures s where s.challenge_id = (select id from signed where habit = 'read')) then
    raise exception 'FAIL: a deleted challenge left its signature';
  end if;
end $$;

rollback;

select 'PASS: signatures are kept with the profile''s name, readable only by the signer, checked, and never written directly' as result;
