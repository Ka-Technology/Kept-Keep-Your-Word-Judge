-- habitkept.com's waitlist (T90, plan.md decision 89): the launch site's form adds an email, signed
-- out, with the publishable key. join_waitlist() is the only way in, and it returns nothing, so the
-- form can't be used to find out whether an email is on the list; nobody reads or writes the table
-- directly (the owner reads it in the dashboard). The email is kept for launch news and deleted on
-- request (the privacy policy). Proven by supabase/tests/waitlist_rls.sql; rls_everywhere.sql lists
-- join_waitlist() as the second definer function callable signed out, after username_available().
-- ponytail: no rate limit beyond the form's honeypot; add a Turnstile check (an Edge Function) if spam shows up.

create table public.waitlist (
  email text primary key
    constraint waitlist_email_format check (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;
revoke all on public.waitlist from anon, authenticated;

create function public.join_waitlist(email text) returns void
  language sql security definer set search_path = ''
  as $$
    insert into public.waitlist (email) values (lower(btrim(join_waitlist.email))) on conflict do nothing;
  $$;

revoke execute on function public.join_waitlist(text) from public;
grant execute on function public.join_waitlist(text) to anon, authenticated;
