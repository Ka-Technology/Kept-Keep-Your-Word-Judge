-- Any length from 28 to 365 completed days (owner, 2026-09-25), instead of only 28, 42 or 56.
-- 28 is the minimum from SPEC.md; 365 keeps a stake from being held open-endedly.
-- Must match LENGTH_LIMITS in src/lib/challenges.ts (tested in challenges.test.ts).
alter table public.challenges drop constraint challenges_length_days_check;
alter table public.challenges add constraint challenges_length_days_check check (length_days between 28 and 365);
