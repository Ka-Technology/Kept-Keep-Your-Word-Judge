-- Security review, 2026-10-01: three ways to pass a day without doing it, by calling the API
-- directly instead of using the app, and a public file a deleted account could leave behind.
--
-- 1. A check-in could be saved without a photo for any habit. The AI job then had nothing to look
--    at and approved it as "unsure". Now every habit but Learn a language (whose check is the quiz)
--    needs a photo, and Read needs the book and pages its quiz is about.
-- 2. A challenger never asked about Kept's AI (profiles.ai_allowed null) has unchecked days excused,
--    so accounts from before T54 aren't penalized for Kept's gap (0036). The app asks before the
--    first check-in, but a direct insert could skip the question forever and pass every day. Now a
--    check-in waits for the answer (`ai_choice_needed`), so only check-ins from before T54 are excused.
-- 3. Account deletion removes the user's profile photos from the app, ignoring failures, and the
--    `avatars` bucket is public. orphan_avatars() lists files whose user is gone, and the ai-check
--    function's scheduled run deletes them, as it already does for check-in photos (0016).
--
-- Must match checkInErrorMessage() in src/lib/challenges.ts. Proven by supabase/tests/verification_rls.sql.

-- 0004's rule (a running challenge's current day), plus the three checks above.
create or replace function public.check_ins_before_insert() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  c public.challenges;
begin
  if (select auth.role()) = 'authenticated' then
    select * into c from public.challenges where id = new.challenge_id;
    if c.id is null or c.outcome is not null or new.day <> public.challenge_day(c) then
      raise exception 'check_in_not_today' using errcode = '23514';
    end if;
    -- The challenger's own check-in (anyone else's is refused by row-level security).
    if c.user_id = (select auth.uid()) then
      if (select p.ai_allowed from public.profiles p where p.id = c.user_id) is null then
        raise exception 'ai_choice_needed' using errcode = '23514';
      end if;
      if c.habit_id <> 'language' and new.photo_path is null then
        raise exception 'check_in_photo_required' using errcode = '23514';
      end if;
      if c.habit_id = 'read' and (nullif(btrim(new.book), '') is null or nullif(btrim(new.pages), '') is null) then
        raise exception 'check_in_read_details' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end $$;

-- Profile photos whose account no longer exists (Storage doesn't cascade). Definer, to read
-- auth.users. ponytail: 1000 a run, the rest the next run, like expired_check_in_photos().
create function public.orphan_avatars() returns setof text
  language sql stable security definer set search_path = ''
  as $$
    select o.name
    from storage.objects o
    where o.bucket_id = 'avatars'
      and not exists (select 1 from auth.users u where u.id::text = (storage.foldername(o.name))[1])
    limit 1000
  $$;

revoke execute on function public.orphan_avatars() from public, anon, authenticated;
grant execute on function public.orphan_avatars() to service_role;
