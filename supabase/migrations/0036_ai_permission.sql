-- Ask before check-ins go to Kept's AI (T54; App Review guideline 5.1.2(i): explicit permission before
-- personal data goes to a third-party AI). profiles.ai_allowed is the challenger's answer: null until
-- asked (before their first check-in), then true (Allow) or false (Don't allow); they can change it
-- in Settings → Privacy & security. Nothing reaches Anthropic unless it's true: the AI job's claim
-- takes only allowed challengers' check-ins, and the quiz function refuses the rest.
--
-- Owner, 2026-09-30: with Don't allow, only friends who pledged check the days (T60), so a day none
-- of them approved by the time it ended is a miss (rejected, with a reason, and appealable to a
-- person). A challenger never asked (an account from before T54) isn't penalized for Kept's gap:
-- their unchecked day counts as done (excused). Proven by supabase/tests/verification_rls.sql.

alter table public.profiles add column ai_allowed boolean;
grant update (ai_allowed) on public.profiles to authenticated;

-- 0020's rules, with the AI job ending an unchecked day for a challenger who didn't allow the AI:
-- pending or flagged → rejected (Don't allow) or excused (never asked).
create or replace function public.check_ins_before_update() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  me uuid := (select auth.uid());
  caller text := (select auth.role());
begin
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

-- 0021's run. First, ended days that no friend approved, for challengers who didn't allow the AI:
-- a miss after Don't allow, done if never asked. Then the AI takes only allowed challengers' check-ins.
create or replace function public.ai_check_claim(only_challenge uuid default null)
  returns table (id uuid, habit_id text, day int, photo_path text, photo_taken_at timestamptz, time_zone text,
                 flag_note text, retake_asked boolean, day_ended boolean, book text, quiz jsonb)
  language sql set search_path = ''
  as $$
    update public.check_ins set status = 'excused'
      where status = 'ai_checking' and ai_checked_at < now() - interval '10 minutes';
    update public.check_ins ci set status = 'rejected'
      from public.challenges c
      where c.id = ci.challenge_id
        and (only_challenge is null or c.id = only_challenge)
        and ci.status = 'retake' and ci.day < public.challenge_day(c);
    update public.check_ins ci
      set status = case when p.ai_allowed is false then 'rejected' else 'excused' end,
          ai_reason = case when p.ai_allowed is false
                           then 'No friend who backs you approved this before the day ended, and you chose not to let Kept’s AI check your days.' end
      from public.challenges c join public.profiles p on p.id = c.user_id
      where c.id = ci.challenge_id
        and (only_challenge is null or c.id = only_challenge)
        and p.ai_allowed is not true
        and ci.status in ('pending', 'flagged')
        and ci.day < public.challenge_day(c);
    update public.check_ins ci set status = 'ai_checking'
      from public.challenges c join public.profiles p on p.id = c.user_id
      where c.id = ci.challenge_id
        and (only_challenge is null or c.id = only_challenge)
        and p.ai_allowed
        and ci.status in ('pending', 'flagged')
        and (ci.day < public.challenge_day(c)
             or ((now() at time zone c.time_zone)::time >= '22:00' and c.habit_id not in ('read', 'language'))
             or (ci.status = 'pending' and ci.retake_asked))
      returning ci.id, c.habit_id, ci.day, ci.photo_path, ci.photo_taken_at, c.time_zone, ci.flag_note,
                ci.retake_asked, ci.day < public.challenge_day(c), ci.book, ci.quiz;
  $$;

revoke execute on function public.ai_check_claim(uuid) from public, anon, authenticated;
grant execute on function public.ai_check_claim(uuid) to service_role;
