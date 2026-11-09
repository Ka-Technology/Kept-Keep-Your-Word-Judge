-- Two more pushes about Kept's AI (owner, 2026-11-03; SPEC-notifications.md section 2), both under "Your check-ins":
-- 1. The AI's result: a day the AI approved, or counted because it couldn't tell or couldn't be asked, now pushes
--    like a retake or a rejection did (0029). Only the AI moves a check-in from ai_checking, so a friend's approval
--    never gets here.
-- 2. The quiz opening: for Read and Learn a language, at the user's step-in time (never later than 11 pm, as the quiz
--    itself), a push says the quiz is open, once for each challenge and day. The 15-minute job notify_quiz_open()
--    finds them; quiz_open_pushes remembers which were sent. Server only.
-- Proven by supabase/tests/ai_pushes_rls.sql.

-- 1. The result

create or replace function public.check_ins_notify() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if new.status = 'pending' and (tg_op = 'INSERT' or old.status = 'flagged') then
      perform public.call_notify(jsonb_build_object('check_in', new.id, 'new_photo', tg_op = 'UPDATE'));
    elsif tg_op = 'UPDATE' and ((old.status, new.status) in (('pending', 'flagged'), ('ai_checking', 'retake'),
                                                              ('ai_checking', 'approved'), ('ai_checking', 'excused'))
                                or (old.status in ('ai_checking', 'retake') and new.status = 'rejected')) then
      perform public.call_notify(jsonb_build_object('check_in_result', new.id));
    end if;
    return null;
  end
  $$;

-- 2. The quiz opening

create table public.quiz_open_pushes (
  challenge_id uuid not null references public.challenges on delete cascade,
  day          int  not null,
  sent_at      timestamptz not null default now(),
  primary key (challenge_id, day)
);
alter table public.quiz_open_pushes enable row level security;
revoke all on public.quiz_open_pushes from anon, authenticated;

/**
 * Pushes, once for each challenge and day, that the quiz is open: the challenge runs Read or Learn a language for a
 * user who lets Kept's AI check their days, it's past the quiz's opening time in the challenge's zone (the user's
 * step-in time, never later than 11 pm: 1380), and the day still needs the quiz (a Read photo waiting for friends, or
 * a Learn a language day with nothing done yet). Returns how many it sent.
 */
create function public.notify_quiz_open() returns int
  language plpgsql security definer set search_path = ''
  as $$
  declare
    r record;
    sent int := 0;
  begin
    for r in
      select c.id, public.challenge_day(c) as day
      from public.challenges c join public.profiles p on p.id = c.user_id
      where c.habit_id in ('read', 'language')
        and c.outcome is null
        and p.ai_allowed is true
        and public.challenge_day(c) between 1 and c.length_days + 3
        and (extract(hour from now() at time zone c.time_zone) * 60 + extract(minute from now() at time zone c.time_zone))
            >= least(p.ai_from_minutes, 1380)
        and case c.habit_id
              when 'read' then exists (select 1 from public.check_ins ci
                                       where ci.challenge_id = c.id and ci.day = public.challenge_day(c) and ci.status in ('pending', 'flagged'))
              else not exists (select 1 from public.check_ins ci
                               where ci.challenge_id = c.id and ci.day = public.challenge_day(c) and ci.status not in ('pending', 'flagged'))
            end
    loop
      insert into public.quiz_open_pushes (challenge_id, day) values (r.id, r.day) on conflict do nothing;
      if found then
        perform public.call_notify(jsonb_build_object('quiz_open', r.id, 'day', r.day));
        sent := sent + 1;
      end if;
    end loop;
    return sent;
  end
  $$;

revoke execute on function public.notify_quiz_open() from public, anon, authenticated;
grant execute on function public.notify_quiz_open() to service_role;

select cron.schedule('quiz-open-push', '*/15 * * * *', $$ select public.notify_quiz_open() $$);
