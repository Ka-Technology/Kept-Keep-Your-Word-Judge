-- One profile per account: the minimum needed to identify a user and enforce the 18+ and US-state rules.
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  date_of_birth date not null check (date_of_birth <= current_date - interval '18 years'),
  state_code    text not null check (state_code in (
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
    'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
    'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
  )),
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Read-only after creation: date of birth and state will gate cash pots, so editing them
-- needs its own rules when an edit-profile screen exists. Deletion goes through delete_account().
revoke all on public.profiles from anon, authenticated;
grant select, insert on public.profiles to authenticated;

create policy "own profile read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy "own profile insert" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));

-- Deletes the caller's auth user; the profile goes with it via on delete cascade.
create function public.delete_account() returns void
  language sql security definer set search_path = ''
  as $$ delete from auth.users where id = auth.uid(); $$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
