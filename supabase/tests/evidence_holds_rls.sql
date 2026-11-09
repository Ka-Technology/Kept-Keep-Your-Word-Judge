-- Proves the dispute evidence hold (migration 0074, T179, plan.md decision 117): a challenge whose card was really
-- charged keeps its check-in photos until 180 days after its latest charge, as evidence if the charge is
-- disputed: the 30-day sweep and the account's own deletion skip them, and once they'd otherwise be gone (30
-- days after the challenge ended, or the account deleted) nobody can see them. After the 180 days the sweep
-- deletes them. A challenge paid only from Kept balance, or not paid at all, holds nothing.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/evidence_holds_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ae', 'evidence-a@kept.test'),
  ('00000000-0000-4000-8000-0000000000be', 'evidence-b@kept.test');
insert into public.profiles (id, username, date_of_birth, state_code) values
  ('00000000-0000-4000-8000-0000000000ae', 'ev_test_a', '1990-01-01', 'OR'),
  ('00000000-0000-4000-8000-0000000000be', 'ev_test_b', '1990-01-01', 'CA');
insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
  ('00000000-0000-4000-8000-0000000000ae', '00000000-0000-4000-8000-0000000000be', 'accepted', now());

do $$
begin
  if has_table_privilege('authenticated', 'public.evidence_holds', 'select') or has_table_privilege('anon', 'public.evidence_holds', 'select') then
    raise exception 'FAIL: the app can read the evidence holds';
  end if;
end $$;

-- A's card-paid Work out and pretend Read both ended 40 days ago, each with a check-in photo.
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, pay_card, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000ae', 'workout', 28, 2500, 'aspca', 'card', true, 'America/Los_Angeles', now());
insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at)
  values ('00000000-0000-4000-8000-0000000000ae', 'read', 28, 2000, 'aspca', 'card', 'America/Los_Angeles', now());
create temporary table ids on commit drop as
  select habit_id, id from public.challenges where user_id = '00000000-0000-4000-8000-0000000000ae';
grant select on ids to authenticated;
select public.card_charge_succeeded((select id from public.charges where challenge_id = (select id from ids where habit_id = 'workout')), 'pi_ev_stake');
update public.challenges set outcome = 'not_finished', ended_on_day = 9, ended_at = now() - interval '40 days' where id in (select id from ids);
insert into storage.objects (bucket_id, name, owner_id)
select 'check-in-photos', '00000000-0000-4000-8000-0000000000ae/' || id || '/1.jpg', '00000000-0000-4000-8000-0000000000ae' from ids;

do $$
begin
  if (select until::date from public.evidence_holds where challenge_id = (select id from ids where habit_id = 'workout')) <> (now() + interval '180 days')::date then
    raise exception 'FAIL: a real charge didn''t hold its challenge''s photos for 180 days';
  end if;
  if exists (select 1 from public.evidence_holds where challenge_id = (select id from ids where habit_id = 'read')) then
    raise exception 'FAIL: a pretend challenge holds its photos';
  end if;
  -- The sweep takes the pretend one's photo, not the held one.
  if exists (select 1 from public.expired_check_in_photos() n where n like '%' || (select id from ids where habit_id = 'workout') || '%')
     or not exists (select 1 from public.expired_check_in_photos() n where n like '%' || (select id from ids where habit_id = 'read') || '%') then
    raise exception 'FAIL: the sweep doesn''t keep held photos, or keeps the rest';
  end if;
end $$;

-- As A: the held photo is out of sight (its 30 days are over), and the delete policy keeps it (Storage refuses a
-- direct delete in SQL, so the policy's rule is checked); as B, A's friend, nothing shows either.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000ae","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from storage.objects where name like '%' || (select id from ids where habit_id = 'workout') || '%') then
    raise exception 'FAIL: a held photo past its 30 days is visible to its owner';
  end if;
  if not public.photo_held('00000000-0000-4000-8000-0000000000ae/' || (select id from ids where habit_id = 'workout') || '/1.jpg')
     or public.photo_held('00000000-0000-4000-8000-0000000000ae/' || (select id from ids where habit_id = 'read') || '/1.jpg') then
    raise exception 'FAIL: the delete policy''s hold is wrong';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000be","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from storage.objects where name like '%' || (select id from ids where habit_id = 'workout') || '%') then
    raise exception 'FAIL: a friend sees a held photo';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- A is deleted (by the dashboard): the hold outlives the account. 180 days on, the sweep takes the photo.
delete from auth.users where id = '00000000-0000-4000-8000-0000000000ae';

do $$
begin
  if not exists (select 1 from public.evidence_holds where until > now()) then raise exception 'FAIL: the hold went with the account'; end if;
  if exists (select 1 from public.expired_check_in_photos() n where n like '%' || (select id from ids where habit_id = 'workout') || '%') then
    raise exception 'FAIL: the sweep took a held photo of a deleted account';
  end if;
  update public.evidence_holds set until = now() - interval '1 day';
  if not exists (select 1 from public.expired_check_in_photos() n where n like '%' || (select id from ids where habit_id = 'workout') || '%') then
    raise exception 'FAIL: a photo past its hold isn''t swept';
  end if;
end $$;

rollback;

select 'PASS: a really charged challenge''s photos are held 180 days after its charge, past the sweep and the account, out of everyone''s sight, then swept' as result;
