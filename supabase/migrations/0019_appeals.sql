-- Verification, part 5 (T29, SPEC-verification.md): appeals. On a rejected day the challenger
-- appeals once, within 7 days of the rejection, with a short note (#14). The owner decides in the
-- Supabase dashboard (no user at all): restore the day (excused, #15) or uphold it (rejected, #16),
-- with an optional note the challenger sees. If the restored day ended the challenge, the owner also
-- clears the recorded outcome; users still can't.

alter table public.check_ins
  add column appeal_note       text check (char_length(appeal_note) <= 500),
  add column appealed_at       timestamptz,
  add column appeal_decided_at timestamptz,
  add column owner_note        text check (char_length(owner_note) <= 500);

grant update (appeal_note) on public.check_ins to authenticated;

-- Who may change a check-in, as in 0018, with the challenger's appeal and the owner's decision
-- recorded by the database.
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
    -- An appeal (#14): once per check-in, within 7 days of the AI's rejection, with a short note.
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

-- An outcome, once recorded, is final, except that the owner (the dashboard, with no user) may clear
-- it after restoring the day that ended the challenge. The app then records the new ending.
create or replace function public.challenges_before_update() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if old.outcome is not null and (select auth.role()) is not null
     and (new.outcome, new.ended_on_day, new.ended_at) is distinct from (old.outcome, old.ended_on_day, old.ended_at) then
    raise exception 'outcome_is_final' using errcode = '23514';
  end if;
  return new;
end $$;
