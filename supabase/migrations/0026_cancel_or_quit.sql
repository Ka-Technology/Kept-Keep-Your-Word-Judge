-- Cancel within Day 1, or quit (T52; SPEC.md money rules, plan.md decision 35). A challenger can
-- cancel until the end of Day 1: the challenge ends as `cancelled` (on day 0 if it hadn't started),
-- and the stake and every pledge come back while the service fee is kept (settle() in
-- challenge-rules.ts). From Day 2 they can quit instead, which ends it as `not_finished`, the same
-- as losing the third shield; quitting during Day 1 is refused, since cancelling returns the stake.
-- A cancelled challenge frees its habit and stays out of the completion rate (the app's meStats).
-- Must match cancelOrQuit() in src/lib/challenges.ts. Proven by supabase/tests/challenges_rls.sql.

alter table public.challenges drop constraint challenges_outcome_check;
alter table public.challenges add constraint challenges_outcome_check check (outcome in ('finished', 'not_finished', 'cancelled'));
alter table public.challenges drop constraint challenges_ended_on_day_check;
alter table public.challenges add constraint challenges_ended_on_day_check check (ended_on_day >= 0);

-- The day rules for a challenger ending their own challenge. The owner (dashboard) and server jobs
-- aren't `authenticated`; an outcome, once recorded, stays final (challenges_before_update).
create function public.challenges_end_early_rule() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if (select auth.role()) = 'authenticated' and old.outcome is null then
    if new.outcome = 'cancelled' and public.challenge_day(old) > 1 then raise exception 'cancel_too_late'; end if;
    if new.outcome = 'not_finished' and public.challenge_day(old) <= 1 then raise exception 'quit_on_day_1'; end if;
  end if;
  return new;
end $$;

create trigger challenges_end_early_rule before update of outcome on public.challenges
  for each row execute function public.challenges_end_early_rule();

revoke execute on function public.challenges_end_early_rule() from public, anon, authenticated;
