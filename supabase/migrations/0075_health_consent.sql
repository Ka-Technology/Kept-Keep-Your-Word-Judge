-- The separate consent for health habits (T179; plan.md decision 119; the privacy policy's "Consumer health data").
-- profiles.health_allowed is the person's answer: null until the app asks, before their first challenge or tracker
-- with a health habit (src/lib/health-consent.ts), then true or false; Settings → Privacy & security changes it.
-- Only its owner sets it (the profile's own-row update policy). ponytail: the app asks and the database doesn't
-- refuse yet, since builds before this one don't ask; a check on challenges and trackers once none can start one.
-- Proven by supabase/tests/health_consent_rls.sql.

alter table public.profiles add column health_allowed boolean;
grant update (health_allowed) on public.profiles to authenticated;
