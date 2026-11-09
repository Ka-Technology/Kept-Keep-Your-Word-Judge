-- Sign in with a username (T147, plan.md decision 102, SPEC-identity.md): the `sign-in` Edge Function
-- counts wrong passwords per account here, and after 10 in an hour stops trying that username (email,
-- Apple, Google and Face ID still work). Usernames are public, so this keeps anyone from trying
-- password after password against one. Only the function (service role) reads or writes it; a
-- successful sign-in clears the account's rows, and they go with the account.
-- Proven by supabase/tests/sign_in_rls.sql.

create table public.sign_in_failures (
  user_id   uuid not null references auth.users (id) on delete cascade,
  failed_at timestamptz not null default now()
);
create index sign_in_failures_user on public.sign_in_failures (user_id, failed_at);

alter table public.sign_in_failures enable row level security;
revoke all on public.sign_in_failures from anon, authenticated;
grant select, insert, delete on public.sign_in_failures to service_role;
