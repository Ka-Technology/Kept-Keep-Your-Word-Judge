-- Resubmit after a friend's "doesn't look right" (owner, 2026-09-26; SPEC-verification.md #12):
-- a flag asks the challenger for a new photo. Sending one replaces the old photo and returns the
-- check-in to pending with the flag cleared, so friends review the new photo. Without a new photo,
-- the AI checks the flagged one near the deadline, with the friend's note (T27).
create or replace function public.check_ins_before_update() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  me uuid := (select auth.uid());
begin
  if (select auth.role()) is distinct from 'authenticated' then
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
