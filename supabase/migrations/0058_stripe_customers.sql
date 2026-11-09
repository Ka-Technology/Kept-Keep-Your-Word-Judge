-- Real cards, saved through Stripe (T92; SPEC-payments.md "Saving a card"). The `payments` Edge Function
-- finds or creates each user's Stripe Customer and keeps only its id here; Stripe's own sheet takes the
-- card, so no card number ever reaches Kept. Which card is the default lives on the Customer in Stripe.
-- Only the server (the function's service role) reads or writes this table, and the row goes with the
-- account (the function deletes the Customer first). Proven by supabase/tests/stripe_customers_rls.sql.

create table public.stripe_customers (
  user_id     uuid primary key references auth.users on delete cascade,
  customer_id text not null unique,
  created_at  timestamptz not null default now()
);

alter table public.stripe_customers enable row level security;
revoke all on public.stripe_customers from anon, authenticated;
