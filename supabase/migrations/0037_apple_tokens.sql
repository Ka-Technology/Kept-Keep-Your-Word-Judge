-- Sign in with Apple's token revocation (T10; App Review: deleting an account must revoke its Apple
-- tokens, and Supabase doesn't). Right after an Apple sign-in, the app hands the `apple-token` Edge
-- Function Apple's one-time authorization code; the function exchanges it for a refresh token and
-- keeps it here. Before the account is deleted, the function revokes it with Apple. Only the server
-- (the function's service role) reads or writes this table; the app never sees a token. It goes
-- with the account. Proven by supabase/tests/profiles_rls.sql.

create table public.apple_tokens (
  user_id       uuid primary key references auth.users on delete cascade,
  refresh_token text not null,
  updated_at    timestamptz not null default now()
);

alter table public.apple_tokens enable row level security;
revoke all on public.apple_tokens from anon, authenticated;
