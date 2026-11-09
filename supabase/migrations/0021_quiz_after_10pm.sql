-- The quiz window (owner, 2026-09-27; SPEC-verification.md): friends get the first chance to
-- approve. From 10 pm in the challenge's zone, if none has, a Read or Learn a language challenger can
-- take the AI quiz instead (the quiz function enforces the hour). So the AI job's 10 pm runs leave
-- those two habits alone; they're decided once their day has ended, from the photo and any quiz
-- answers. Other habits are still checked from 10 pm. Otherwise as in 0020.

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
    update public.check_ins ci set status = 'ai_checking'
      from public.challenges c
      where c.id = ci.challenge_id
        and (only_challenge is null or c.id = only_challenge)
        and ci.status in ('pending', 'flagged')
        and (ci.day < public.challenge_day(c)
             or ((now() at time zone c.time_zone)::time >= '22:00' and c.habit_id not in ('read', 'language'))
             or (ci.status = 'pending' and ci.retake_asked))
      returning ci.id, c.habit_id, ci.day, ci.photo_path, ci.photo_taken_at, c.time_zone, ci.flag_note,
                ci.retake_asked, ci.day < public.challenge_day(c), ci.book, ci.quiz;
  $$;
