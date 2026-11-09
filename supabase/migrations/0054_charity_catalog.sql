-- Charity catalog (Every.org search): a challenger can search any US nonprofit through Every.org, or pick
-- one of Kept's curated charities. A searched nonprofit becomes a `charities` row the first time someone
-- picks it (the `charities` Edge Function writes it, from Every.org's own answer for its EIN), so
-- challenges.charity_id and donations.charity_id keep pointing at this table and every screen keeps reading
-- the name through them. `featured` marks Kept's curated picks (the app lists these first); the 11 seeded in
-- 0004 all stay, because challenges already use them, but founders-pledge-climate, a fund that passes money
-- on, is no longer featured. ein, slug and logo_url start empty for the curated ones and are filled once the
-- Every.org key works. Still read-only for app users: no new grants, so only the owner key writes.
-- Proven by supabase/tests/challenges_rls.sql.

alter table public.charities
  add column ein      text unique check (ein ~ '^[0-9]{9}$'),
  add column slug     text check (slug ~ '^[A-Za-z0-9-]+$'),
  add column logo_url text check (logo_url like 'https://%'),
  add column featured boolean not null default false;

update public.charities set featured = true where id <> 'founders-pledge-climate';
