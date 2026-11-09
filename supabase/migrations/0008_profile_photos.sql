-- Profile photos (owner, 2026-09-26, T47; SPEC-identity.md). A user may add a photo; it shows
-- wherever their username does, so the bucket is public-read. Only the owner can write in their
-- own folder, and avatar_path can only point there. Must match src/lib/avatar.ts (tested).
alter table public.profiles add column avatar_path text
  constraint profiles_avatar_path_own_folder check (avatar_path is null or avatar_path like id::text || '/%');

grant update (avatar_path) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png']);

-- Uploads, listing (to clean up) and deletes only in your own folder: {user id}/...
create policy "own avatar upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own avatar read" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own avatar delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
