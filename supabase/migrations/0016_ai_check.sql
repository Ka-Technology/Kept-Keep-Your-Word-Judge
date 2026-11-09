-- Verification, part 3 (T27, SPEC-verification.md): the AI job, with a stub verdict until T28.
-- Every 15 minutes Supabase Cron calls the ai-check Edge Function (service role), which takes the
-- due check-ins (ai_check_claim), then decides each one: approve, or excused if deciding fails.
-- The same run deletes check-in photos 30 days after their challenge ends. "Next day (demo)" goes
-- through the same function (demo_next_day), so the app loses its update grant on day_offset.

-- When the AI job last moved a check-in, set by the database (the app shows "Approved by Kept's AI").
alter table public.check_ins add column ai_checked_at timestamptz;

-- Who may change a check-in (SPEC-verification.md's table), now with the AI job's part: only the
-- service role, and only its own moves (#5-#10, #13). The owner (the dashboard, with no user at
-- all) is still unrestricted; T29 pins appeals.
create or replace function public.check_ins_before_update() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  me uuid := (select auth.uid());
  caller text := (select auth.role());
begin
  if caller = 'service_role' then
    if (old.status, new.status) in (('pending', 'ai_checking'), ('flagged', 'ai_checking'), ('ai_checking', 'approved'),
        ('ai_checking', 'retake'), ('ai_checking', 'rejected'), ('ai_checking', 'excused'), ('retake', 'rejected')) then
      new.ai_checked_at := now();
      return new;
    end if;
    raise exception 'check_in_change_not_allowed' using errcode = '23514';
  end if;
  if caller is distinct from 'authenticated' then
    return new;
  end if;
  if exists (select 1 from public.challenges where id = new.challenge_id and user_id = me) then
    -- The challenger: a new photo while pending (#2), after the AI asked for one (#11), or after a
    -- friend's "doesn't look right" (#12), which clears the flag for a fresh review.
    if new.photo_path is not null and new.photo_path is distinct from old.photo_path
       and old.status in ('pending', 'retake', 'flagged') and new.status = 'pending'
       and new.flag_note is not distinct from old.flag_note then
      if old.status = 'flagged' then
        new.flag_note := null;
        new.reviewer_id := null;
        new.reviewed_at := null;
      end if;
      return new;
    end if;
  elsif public.can_review(new.challenge_id) then
    -- An eligible friend: approve (#3), or ask for a new photo with an optional note (#4). Never reject.
    if old.status = 'pending' and new.status in ('approved', 'flagged')
       and new.photo_path is not distinct from old.photo_path
       and (new.status = 'flagged' or new.flag_note is not distinct from old.flag_note) then
      new.reviewer_id := me;
      new.reviewed_at := now();
      return new;
    end if;
  end if;
  raise exception 'check_in_change_not_allowed' using errcode = '23514';
end $$;

-- The AI job's pick (#5-#6): pending check-ins, and flagged ones that got no new photo, in their
-- day's last 2 hours (from 10 pm in the challenge's zone) or from a day that has ended (the demo
-- clock included). They move to ai_checking and come back with the friend's note for the verdict.
-- `only_challenge` limits it to one challenge ("Next day"). First, any left in ai_checking for 10
-- minutes (a run that died) count as done (#10): a Kept error is never the challenger's miss.
create function public.ai_check_claim(only_challenge uuid default null) returns setof public.check_ins
  language sql set search_path = ''
  as $$
    update public.check_ins set status = 'excused'
      where status = 'ai_checking' and ai_checked_at < now() - interval '10 minutes';
    update public.check_ins ci set status = 'ai_checking'
      from public.challenges c
      where c.id = ci.challenge_id
        and (only_challenge is null or c.id = only_challenge)
        and ci.status in ('pending', 'flagged')
        and (ci.day < public.challenge_day(c) or (now() at time zone c.time_zone)::time >= '22:00')
      returning ci.*;
  $$;

-- "Next day (demo)" (T19) through the server: the ai-check function moves the signed-in
-- challenger's own challenge on a day, then runs the check, which finds the day just ended like any
-- other. False if it isn't theirs. Remove with `day_offset` before `payments`.
create function public.demo_next_day(challenge uuid, challenger uuid) returns boolean
  language sql set search_path = ''
  as $$
    with moved as (
      update public.challenges set day_offset = day_offset + 1 where id = challenge and user_id = challenger returning 1
    )
    select exists (select 1 from moved)
  $$;

-- Check-in photos due for deletion (SPEC-verification.md, Photos): 30 days after their challenge
-- ended, or whose user no longer exists (Storage doesn't cascade). The ai-check function deletes
-- them through the Storage API; the check-in, its stamp and verdict stay. Definer, to read auth.users.
-- ponytail: 1000 a run, the rest the next run. A challenge whose ending the app never recorded
-- keeps its photos until `payments` moves the ending to the server (T49's list).
create function public.expired_check_in_photos() returns setof text
  language sql stable security definer set search_path = ''
  as $$
    select o.name
    from storage.objects o
    where o.bucket_id = 'check-in-photos'
      and (not exists (select 1 from auth.users u where u.id::text = (storage.foldername(o.name))[1])
           or exists (select 1 from public.challenges c
                      where c.id::text = (storage.foldername(o.name))[2] and c.ended_at < now() - interval '30 days'))
    limit 1000
  $$;

revoke execute on function public.ai_check_claim(uuid), public.demo_next_day(uuid, uuid), public.expired_check_in_photos()
  from public, anon, authenticated;
grant execute on function public.ai_check_claim(uuid), public.demo_next_day(uuid, uuid), public.expired_check_in_photos()
  to service_role;

-- The app no longer moves the demo clock itself.
revoke update (day_offset) on public.challenges from authenticated;

-- Every 15 minutes (SPEC-verification.md decision 7). The project URL and the default secret key
-- live in Vault, never in git; the owner adds them once in the SQL editor:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<the default sb_secret_ key>', 'secret_key');
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule('ai-check', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/ai-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')
    )
  )
$$);
