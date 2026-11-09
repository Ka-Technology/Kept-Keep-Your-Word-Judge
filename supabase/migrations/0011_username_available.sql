-- Sign-up checks the username is free before the account is created and the code is emailed
-- (owner, 2026-09-26), so "That username is taken." shows on the sign-up form, not after the code.
-- Signed-out users can't read profiles, so this answers only yes or no for one exact username.
-- The unique constraint stays the authority: a name taken in the meantime is still refused when
-- complete-profile saves it.
create function public.username_available(name text) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select not exists (select 1 from public.profiles where username = name) $$;

revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
