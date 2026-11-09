-- Dispute evidence (T179; plan.md decision 117; the privacy policy's retention section). A challenge whose card was
-- really charged (a stake or a pledge, T93) keeps its check-in photos until 180 days after its latest charge, as
-- evidence if a charge is disputed (Stripe's window is 120 days; docs/wiki/Money-Exceptions.md). evidence_holds
-- has no foreign keys, so a hold outlives the challenge and the account. While a photo is held:
--   - the 30-day sweep (expired_check_in_photos(), 0016) skips it, as it does once the account is gone;
--   - its owner can't delete it, so the app's own photo clean-up before an account deletion leaves it;
--   - once it would otherwise be gone (30 days after the challenge ended, or with the account), nobody sees it.
-- After the hold, the sweep deletes it. A charge paid wholly from Kept balance can't be disputed, so holds nothing.
-- Proven by supabase/tests/evidence_holds_rls.sql.

create table public.evidence_holds (
  challenge_id uuid primary key,
  until        timestamptz not null
);
alter table public.evidence_holds enable row level security;
revoke all on public.evidence_holds from anon, authenticated;

create function public.charges_evidence_hold() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  insert into public.evidence_holds (challenge_id, until) values (new.challenge_id, new.created_at + interval '180 days')
    on conflict (challenge_id) do update set until = greatest(public.evidence_holds.until, excluded.until);
  return null;
end $$;
create trigger charges_evidence_hold after update of status on public.charges
  for each row when (new.status = 'succeeded' and old.status <> 'succeeded' and new.payment_intent_id is not null and new.challenge_id is not null)
  execute function public.charges_evidence_hold();

insert into public.evidence_holds (challenge_id, until)
select challenge_id, max(created_at) + interval '180 days' from public.charges
where status = 'succeeded' and payment_intent_id is not null and challenge_id is not null
group by challenge_id
on conflict (challenge_id) do nothing;

-- Whether a check-in photo (named <user>/<challenge>/…) is held, and whether it's past the point it'd be gone.
create function public.photo_held(name text) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select exists (select 1 from public.evidence_holds h where h.challenge_id::text = (storage.foldername(name))[2] and h.until > now()) $$;

create function public.photo_hidden(name text) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select public.photo_held(name) and (
      not exists (select 1 from auth.users u where u.id::text = (storage.foldername(name))[1])
      or exists (select 1 from public.challenges c where c.id::text = (storage.foldername(name))[2] and c.ended_at < now() - interval '30 days')
    )
  $$;

-- 0016's, skipping held photos.
create or replace function public.expired_check_in_photos() returns setof text
  language sql stable security definer set search_path = ''
  as $$
    select o.name
    from storage.objects o
    where o.bucket_id = 'check-in-photos'
      and (not exists (select 1 from auth.users u where u.id::text = (storage.foldername(o.name))[1])
           or exists (select 1 from public.challenges c
                      where c.id::text = (storage.foldername(o.name))[2] and c.ended_at < now() - interval '30 days'))
      and not public.photo_held(o.name)
    limit 1000
  $$;

-- 0013's policies, with held photos out of sight once they'd be gone, and never deleted by their owner.
drop policy "own and friends' check-in photos read" on storage.objects;
create policy "own and friends' check-in photos read" on storage.objects
  for select to authenticated
  using (bucket_id = 'check-in-photos' and not public.photo_hidden(name) and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = (select auth.uid()) and f.addressee_id::text = (storage.foldername(name))[1])
          or (f.addressee_id = (select auth.uid()) and f.requester_id::text = (storage.foldername(name))[1])))));
drop policy "own check-in photo delete" on storage.objects;
create policy "own check-in photo delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'check-in-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and not public.photo_held(name));

revoke execute on function public.charges_evidence_hold(), public.photo_held(text), public.photo_hidden(text) from public, anon, authenticated;
grant execute on function public.photo_held(text), public.photo_hidden(text) to authenticated;
