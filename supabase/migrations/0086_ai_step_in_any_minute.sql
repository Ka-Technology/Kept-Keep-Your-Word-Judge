-- The AI's step-in time (0085, plan.md decision 180) from 9:00 pm to midnight, to the minute (owner, 2026-11-03):
-- it was 10:00 pm to midnight in 15-minute steps. Settings now has a clock dial like an alarm's, and the earlier start
-- gives a user who wants the AI to step in sooner a way to say so. Midnight (1440) stays the end of the day, with no
-- retakes. Nothing else changes: ai_check_claim() already compares the minute of the day with ai_from_minutes, so any
-- value works. Cron still runs every 15 minutes, so a time between runs takes effect at the next one. Existing values
-- (10 pm to midnight, on the quarter hour) stay valid. Proven by supabase/tests/ai_last_resort_rls.sql.

alter table public.profiles drop constraint profiles_ai_from_minutes_check;
alter table public.profiles
  add constraint profiles_ai_from_minutes_check check (ai_from_minutes between 1260 and 1440);
