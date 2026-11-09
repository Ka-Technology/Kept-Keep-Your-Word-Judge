-- Verification, part 1 (T25, SPEC-verification.md): time-coded photo check-ins. Adds the statuses
-- the whole module uses, the photo and Read columns, the challenger's part of the status rules, and
-- the private check-in-photos bucket. A check-in now starts pending, so T18's placeholder (approved
-- at once) ends. Friends' reviews (T26), the AI job (T27-T28) and appeals (T29) add their parts.

alter table public.check_ins
  add column photo_path     text,
  add column photo_taken_at timestamptz,
  add column book           text check (char_length(book) <= 200),
  add column pages          text check (char_length(pages) <= 50);

alter table public.check_ins drop constraint check_ins_status_check;
alter table public.check_ins add constraint check_ins_status_check
  check (status in ('pending', 'flagged', 'ai_checking', 'retake', 'approved', 'rejected', 'appealed', 'excused'));
alter table public.check_ins alter column status set default 'pending';

-- A photo lives in the challenger's own folder for that challenge ({user}/{challenge}/...), and the
-- database records when it arrived: Kept's stamp. The app never sets the time.
create function public.check_ins_photo() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op = 'UPDATE' and new.photo_path is not distinct from old.photo_path then
    return new;
  end if;
  if new.photo_path is not null and (select auth.role()) = 'authenticated'
     and new.photo_path not like (select auth.uid())::text || '/' || new.challenge_id::text || '/%' then
    raise exception 'check_in_photo_not_own' using errcode = '23514';
  end if;
  new.photo_taken_at := case when new.photo_path is null then null else now() end;
  return new;
end $$;

create trigger check_ins_photo before insert or update of photo_path on public.check_ins
  for each row execute function public.check_ins_photo();

-- Who may change a check-in (SPEC-verification.md's table of changes). For now only the
-- challenger, and only with a new photo: while pending (#2), or after the AI asked for one (#11).
-- The AI job (service role) and the owner (the dashboard, with no user at all) aren't
-- `authenticated`; T27-T29 pin their changes here.
create function public.check_ins_before_update() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if (select auth.role()) is distinct from 'authenticated' then
    return new;
  end if;
  if exists (select 1 from public.challenges where id = new.challenge_id and user_id = (select auth.uid()))
     and new.photo_path is not null and new.photo_path is distinct from old.photo_path
     and old.status in ('pending', 'retake') and new.status = 'pending' then
    return new;
  end if;
  raise exception 'check_in_change_not_allowed' using errcode = '23514';
end $$;

create trigger check_ins_before_update before update on public.check_ins
  for each row execute function public.check_ins_before_update();

-- The app sends the photo (and for Read the book and pages) with the check-in, and may change only
-- the photo and the status; the trigger above decides which changes are allowed.
grant insert (book, pages, photo_path) on public.check_ins to authenticated;
grant update (status, photo_path) on public.check_ins to authenticated;

create policy "own check-ins update" on public.check_ins
  for update to authenticated
  using (exists (select 1 from public.challenges c where c.id = challenge_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.challenges c where c.id = challenge_id and c.user_id = (select auth.uid())));

-- Check-in photos: private. Resized to 1000 px in the app (about 150 KB), so 2 MB is plenty.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('check-in-photos', 'check-in-photos', false, 2097152, array['image/jpeg']);

-- Uploads and deletes only in your own folder. Reads: yours, and your accepted friends', so
-- unfriending ends access at once. The AI job reads as the service role.
create policy "own check-in photo upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'check-in-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own and friends' check-in photos read" on storage.objects
  for select to authenticated
  using (bucket_id = 'check-in-photos' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = (select auth.uid()) and f.addressee_id::text = (storage.foldername(name))[1])
          or (f.addressee_id = (select auth.uid()) and f.requester_id::text = (storage.foldername(name))[1])))));
create policy "own check-in photo delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'check-in-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
