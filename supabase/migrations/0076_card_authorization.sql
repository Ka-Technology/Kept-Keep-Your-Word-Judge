-- The card authorization, shown and stored (T179; plan.md decision 124, as decision 142 changed it): the sign step
-- and the pledge sheet show what paying by card authorizes (cardAuthorization() in src/lib/policies.ts: one charge
-- now, money that comes back to the card or Kept balance, the fee kept), and `payments` stores those exact words on
-- the charge with when they were accepted, before charging, as evidence if the charge is disputed. A charge's
-- owner reads them with the rest of the row; only the server writes them. A stake's signing is also the
-- challenge's consented_at.

alter table public.charges
  add column card_authorization text check (char_length(card_authorization) <= 1000),
  add column authorized_at timestamptz;
