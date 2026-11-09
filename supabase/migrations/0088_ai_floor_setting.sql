-- The AI allowance's floor (0085: "3 calls for each running challenge, at least 4") becomes a setting, so the test project, which
-- feeds the judges' TestFlight build, can allow more than production without different code (owner, 2026-11-03).
-- Production keeps the rule as decided: this migration seeds the floor at 4, and production never changes it. The test project is
-- raised by hand, not by a migration:
--   update public.ai_settings set calls_floor = 30;
-- One row, never below 4, the server's alone. Proven by supabase/tests/ai_floor_rls.sql.

create table public.ai_settings (
  id          boolean primary key default true check (id),
  calls_floor int not null default 4 check (calls_floor >= 4)
);
insert into public.ai_settings default values;
alter table public.ai_settings enable row level security;
revoke all on public.ai_settings from anon, authenticated;

create or replace function public.ai_allowance(uid uuid) returns int
  language sql stable set search_path = ''
  as $$
    select greatest((select calls_floor from public.ai_settings), 3 * count(*))::int
    from public.challenges where user_id = uid and outcome is null
  $$;
