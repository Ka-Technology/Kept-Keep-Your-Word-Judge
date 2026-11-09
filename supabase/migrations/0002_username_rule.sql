-- Looser usernames (2026-09-24): lowercase letters, digits, periods, underscores and hyphens,
-- 3–30 characters (was a-z, 0-9 and _, 3–20). Every existing username already fits the new rule.
-- Must match USERNAME_RE in src/lib/profile.ts (tested in profile.test.ts).
alter table public.profiles drop constraint profiles_username_check;
alter table public.profiles add constraint profiles_username_check check (username ~ '^[a-z0-9._-]{3,30}$');
