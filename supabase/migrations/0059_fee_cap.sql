-- The service fee's cap rises from $7.50 to $9.99 (T187; plan.md decision 146). Charged up front, a card
-- payment loses money once Stripe's 2.9% + 30¢ outgrows a capped fee: at $7.50 that happened above a $241
-- stake, at $9.99 it would only above $324, past the $300 limit. Still $1.50 + 3%, now reaching the cap at
-- $283. The SQL twin of serviceFeeCents() in src/lib/challenge-rules.ts; supabase/tests/solana_payments_rls.sql
-- checks both agree.

create or replace function public.service_fee_cents(amount_cents int) returns int
  language sql immutable set search_path = ''
  as $$ select least(150 + round(amount_cents * 0.03)::int, 999) $$;
