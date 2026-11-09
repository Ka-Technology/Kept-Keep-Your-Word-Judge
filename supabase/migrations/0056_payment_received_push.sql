-- "Payment received" push (T169): when solana-pay finds a Solana stake's transfer on chain, the challenger's
-- phones are told (notify's `solana_payment` event), so they can leave their wallet and tap back into Kept: a
-- Solana Pay wallet can't send the user back itself. Only the confirmation that actually changes the payment
-- sends one, so a second look at an already confirmed payment says nothing. call_notify() sends after the
-- transaction commits, and a failed push never touches the payment (0028). Proven by
-- supabase/tests/solana_payments_rls.sql.

create or replace function public.solana_payment_confirmed(payment uuid, sig text, wallet text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  challenge uuid;
begin
  update public.solana_payments
    set status = 'confirmed', signature = sig, payer = wallet, confirmed_at = now()
    where id = payment and status = 'awaiting'
    returning challenge_id into challenge;
  if challenge is null then return; end if;
  update public.challenges set payment_status = 'paid' where id = challenge;
  perform public.call_notify(jsonb_build_object('solana_payment', payment));
end $$;

revoke execute on function public.solana_payment_confirmed(uuid, text, text) from public, anon, authenticated;
grant execute on function public.solana_payment_confirmed(uuid, text, text) to service_role;
