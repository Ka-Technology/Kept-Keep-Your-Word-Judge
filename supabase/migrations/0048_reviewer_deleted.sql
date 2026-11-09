-- Deleting an account that reviewed a friend's check-in (T84). check_ins.reviewer_id is
-- `on delete set null` (0014), so deleting the reviewer updates the friend's check-in, and that update
-- ran through the change rules below as a signed-in user who is neither the challenger nor approving:
-- check_in_change_not_allowed, and the whole deletion rolled back. Now a change that only clears the
-- reviewer goes through. Signed-in users can't update reviewer_id themselves (no column grant;
-- verification_rls.sql), so only the deletion reaches it. 0036's rules otherwise unchanged; proven by
-- supabase/tests/verification_rls.sql.

create or replace function public.check_ins_before_update() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  me uuid := (select auth.uid());
  caller text := (select auth.role());
begin
  -- The reviewer's account was deleted: nothing else about the check-in changes.
  if new.reviewer_id is null and old.reviewer_id is not null
     and (to_jsonb(new) - 'reviewer_id') = (to_jsonb(old) - 'reviewer_id') then
    return new;
  end if;
  if caller = 'service_role' then
    -- A quiz's questions, answers and gradings, while the check-in waits (T42): not a verdict.
    if old.status = 'pending' and new.status = 'pending' then
      return new;
    end if;
    if (old.status, new.status) in (('pending', 'ai_checking'), ('flagged', 'ai_checking'), ('ai_checking', 'approved'),
        ('ai_checking', 'retake'), ('ai_checking', 'rejected'), ('ai_checking', 'excused'), ('retake', 'rejected'),
        ('pending', 'rejected'), ('flagged', 'rejected'), ('pending', 'excused'), ('flagged', 'excused'))
       and not (new.status = 'retake' and old.retake_asked) then
      new.ai_checked_at := now();
      new.retake_asked := old.retake_asked or new.status = 'retake';
      return new;
    end if;
    raise exception 'check_in_change_not_allowed' using errcode = '23514';
  end if;
  if caller is distinct from 'authenticated' then
    -- The owner, in the dashboard: deciding an appeal (#15-#16) is recorded.
    if old.status = 'appealed' and new.status is distinct from 'appealed' then
      new.appeal_decided_at := now();
    end if;
    return new;
  end if;
  if exists (select 1 from public.challenges where id = new.challenge_id and user_id = me) then
    -- The challenger: a new photo while pending (#2), after the AI asked for one (#11), or after a
    -- friend's "doesn't look right" (#12), which clears the flag for a fresh review. Without a
    -- photo, #12 is checking in again.
    if old.status in ('pending', 'retake', 'flagged') and new.status = 'pending'
       and new.flag_note is not distinct from old.flag_note
       and new.appeal_note is not distinct from old.appeal_note
       and ((new.photo_path is not null and new.photo_path is distinct from old.photo_path)
            or (old.status = 'flagged' and old.photo_path is null and new.photo_path is null)) then
      if old.status = 'flagged' then
        new.flag_note := null;
        new.reviewer_id := null;
        new.reviewed_at := null;
      end if;
      return new;
    end if;
    -- An appeal (#14): once per check-in, within 7 days of the rejection, with a short note.
    if old.status = 'rejected' and new.status = 'appealed' and old.appealed_at is null
       and old.ai_checked_at > now() - interval '7 days'
       and nullif(btrim(new.appeal_note), '') is not null
       and new.photo_path is not distinct from old.photo_path
       and new.flag_note is not distinct from old.flag_note then
      new.appealed_at := now();
      return new;
    end if;
  elsif public.can_review(new.challenge_id) then
    -- An eligible friend: approve (#3), or ask for a new photo with an optional note (#4). Never reject.
    if old.status = 'pending' and new.status in ('approved', 'flagged')
       and new.photo_path is not distinct from old.photo_path
       and new.appeal_note is not distinct from old.appeal_note
       and (new.status = 'flagged' or new.flag_note is not distinct from old.flag_note) then
      new.reviewer_id := me;
      new.reviewed_at := now();
      return new;
    end if;
  end if;
  raise exception 'check_in_change_not_allowed' using errcode = '23514';
end $$;
