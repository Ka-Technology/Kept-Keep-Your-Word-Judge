-- Verification, part 4 (T28, SPEC-verification.md): the real AI verdict. The ai-check function asks
-- Claude Haiku 4.5 and records the verdict, its reason (which the challenger sees) and the model on
-- the check-in. A retake is asked for once per check-in, a new photo sent after one is checked at
-- once, and a retake still unanswered when its day ends is not approved (#13).

alter table public.check_ins
  add column ai_verdict   text check (ai_verdict in ('approve', 'retake', 'not_approved', 'unsure')),
  add column ai_reason    text check (char_length(ai_reason) <= 500),
  add column ai_model     text,
  add column retake_asked boolean not null default false;

-- Who may change a check-in, as in 0017, with the AI job's retake asked once: the database marks it
-- and never unmarks it.
create or replace function public.check_ins_before_update() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  me uuid := (select auth.uid());
  caller text := (select auth.role());
begin
  if caller = 'service_role' then
    if (old.status, new.status) in (('pending', 'ai_checking'), ('flagged', 'ai_checking'), ('ai_checking', 'approved'),
        ('ai_checking', 'retake'), ('ai_checking', 'rejected'), ('ai_checking', 'excused'), ('retake', 'rejected'))
       and not (new.status = 'retake' and old.retake_asked) then
      new.ai_checked_at := now();
      new.retake_asked := old.retake_asked or new.status = 'retake';
      return new;
    end if;
    raise exception 'check_in_change_not_allowed' using errcode = '23514';
  end if;
  if caller is distinct from 'authenticated' then
    return new;
  end if;
  if exists (select 1 from public.challenges where id = new.challenge_id and user_id = me) then
    -- The challenger: a new photo while pending (#2), after the AI asked for one (#11), or after a
    -- friend's "doesn't look right" (#12), which clears the flag for a fresh review. Without a
    -- photo, #12 is checking in again.
    if old.status in ('pending', 'retake', 'flagged') and new.status = 'pending'
       and new.flag_note is not distinct from old.flag_note
       and ((new.photo_path is not null and new.photo_path is distinct from old.photo_path)
            or (old.status = 'flagged' and old.photo_path is null and new.photo_path is null)) then
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

-- The AI job's run. First, check-ins left in ai_checking for 10 minutes (a run that died) count as
-- done (#10), and a retake still unanswered when its day has ended is not approved (#13). Then it
-- takes pending check-ins, and flagged ones that got no new photo, in their day's last 2 hours (from
-- 10 pm in the challenge's zone) or from a day that has ended, and a new photo sent after a retake
-- at once (#5-#6). They move to ai_checking and come back with what the AI needs, and whether their
-- day has ended (then there's no time for a retake). `only_challenge` limits it to one challenge.
drop function public.ai_check_claim(uuid);
create function public.ai_check_claim(only_challenge uuid default null)
  returns table (id uuid, habit_id text, day int, photo_path text, photo_taken_at timestamptz, time_zone text,
                 flag_note text, retake_asked boolean, day_ended boolean)
  language sql set search_path = ''
  as $$
    update public.check_ins set status = 'excused'
      where status = 'ai_checking' and ai_checked_at < now() - interval '10 minutes';
    update public.check_ins ci set status = 'rejected'
      from public.challenges c
      where c.id = ci.challenge_id
        and (only_challenge is null or c.id = only_challenge)
        and ci.status = 'retake' and ci.day < public.challenge_day(c);
    update public.check_ins ci set status = 'ai_checking'
      from public.challenges c
      where c.id = ci.challenge_id
        and (only_challenge is null or c.id = only_challenge)
        and ci.status in ('pending', 'flagged')
        and (ci.day < public.challenge_day(c)
             or (now() at time zone c.time_zone)::time >= '22:00'
             or (ci.status = 'pending' and ci.retake_asked))
      returning ci.id, c.habit_id, ci.day, ci.photo_path, ci.photo_taken_at, c.time_zone, ci.flag_note,
                ci.retake_asked, ci.day < public.challenge_day(c);
  $$;

revoke execute on function public.ai_check_claim(uuid) from public, anon, authenticated;
grant execute on function public.ai_check_claim(uuid) to service_role;
