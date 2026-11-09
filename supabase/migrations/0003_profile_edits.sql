-- Settings edits (T39, 2026-09-24): a user can change their own username and state. Date of birth
-- stays read-only because it's the 18+ check, and there's still no delete privilege (delete_account()
-- does that). The username and state checks from 0001/0002 apply to updates too.
-- When `payments` arrives, moving to an excluded state must switch off that user's staked challenges.
grant update (username, state_code) on public.profiles to authenticated;

create policy "own profile update" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
