-- Real names (T145, plan.md decision 100, SPEC-identity.md): each profile's first and last name, for
-- donation receipts and, later, payments. Only the user reads them: profiles stays readable by its
-- owner only, and every function that shows a person to others names its columns (username and photo).
-- Accounts from before have none (null) and add theirs in Personal info; a new profile must have both.
-- Stored trimmed, 1 to 50 characters each; changeable, since legal names change.
-- Proven by supabase/tests/profiles_rls.sql.

alter table public.profiles
  add column first_name text check (first_name = btrim(first_name) and char_length(first_name) between 1 and 50),
  add column last_name text check (last_name = btrim(last_name) and char_length(last_name) between 1 and 50);

grant update (first_name, last_name) on public.profiles to authenticated;

drop policy "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()) and first_name is not null and last_name is not null);
