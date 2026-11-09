-- Recovering two-step verification by an email code (T161; the `two-step-recover` function). One row per person
-- while a code is out: its SHA-256 (salted with the person's id), when it expires (15 minutes), and the wrong tries
-- (5 at most). Only the server reads or writes it. Two-step itself is Supabase's TOTP factors (config.toml
-- [auth.mfa.totp]), which need no table here.
-- Proven by supabase/tests/two_step_rls.sql.

create table public.two_step_recovery (
  user_id    uuid primary key references auth.users on delete cascade,
  code_hash  text not null,
  expires_at timestamptz not null,
  attempts   int  not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now()
);
alter table public.two_step_recovery enable row level security;
revoke all on public.two_step_recovery from anon, authenticated;
