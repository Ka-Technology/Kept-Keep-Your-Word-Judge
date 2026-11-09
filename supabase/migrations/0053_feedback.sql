-- Send feedback (T158, SPEC-app-shell.md "Feedback"): Settings → About → Send feedback saves a bug,
-- an idea, a habit to add or anything else, with the app and iOS versions and an optional photo. Like
-- reports (0035), it's write-only for app users: nobody reads feedback but the owner, in the
-- dashboard, and each one pushes and emails the owner (notify, { feedback }). A row outlives its
-- sender's account; the photo goes with the account (delete-account.ts). The kinds and the limit match
-- src/lib/feedback.ts (feedback.test.ts reads this file). Proven by supabase/tests/feedback_rls.sql.

create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid default auth.uid() references auth.users on delete set null,
  kind        text not null check (kind in ('bug', 'idea', 'habit', 'other')),
  message     text not null check (char_length(btrim(message)) between 1 and 2000),
  photo_path  text check (char_length(photo_path) <= 200),
  app_version text check (char_length(app_version) <= 40),
  os          text check (char_length(os) <= 20),
  os_version  text check (char_length(os_version) <= 40),
  created_at  timestamptz not null default now(),
  -- The owner's: when it was dealt with.
  handled_at  timestamptz
);
create index feedback_open on public.feedback (created_at) where handled_at is null;

alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
grant insert (kind, message, photo_path, app_version, os, os_version) on public.feedback to authenticated;
create policy "feedback as yourself" on public.feedback
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Definer, to count the sender's own feedback, which only the owner may read: at most 5 an hour. A
-- photo must be in the sender's own folder, and the owner's column and the time can't be sent.
create function public.feedback_before_insert() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if (select count(*) from public.feedback f
      where f.user_id = (select auth.uid()) and f.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'feedback_rate_limited' using errcode = '23514';
  end if;
  if new.photo_path is not null and split_part(new.photo_path, '/', 1) <> (select auth.uid())::text then
    raise exception 'feedback_photo_not_yours' using errcode = '23514';
  end if;
  new.created_at := now();
  new.handled_at := null;
  return new;
end $$;

create trigger feedback_before_insert before insert on public.feedback
  for each row execute function public.feedback_before_insert();

-- Each one pushes and emails the owner (notify, { feedback }).
create function public.feedback_notify() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform public.call_notify(jsonb_build_object('feedback', new.id));
  return null;
end $$;

create trigger feedback_notify after insert on public.feedback
  for each row execute function public.feedback_notify();

revoke execute on function public.feedback_before_insert(), public.feedback_notify() from public, anon, authenticated;

-- Feedback photos: private, resized to 1000 px in the app, like check-in photos (0013). The sender
-- can upload, list and delete only their own folder (the list and delete are for deleting the
-- account); the owner opens them through the email's signed link.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('feedback', 'feedback', false, 2097152, array['image/jpeg']);

create policy "own feedback photo upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feedback' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own feedback photo read" on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own feedback photo delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'feedback' and (storage.foldername(name))[1] = (select auth.uid())::text);
