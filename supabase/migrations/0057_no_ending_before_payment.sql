-- A Solana challenge still waiting for its payment can't be cancelled or quit like a running one (owner,
-- 2026-10-26): that recorded "cancelled" and told the challenger their stake came back when nothing had been
-- paid. The app cancels an unpaid challenge through solana-pay's `cancel` instead, which removes it once no
-- payment can still land. The owner (no user JWT) can still change anything. Proven by
-- supabase/tests/solana_payments_rls.sql.

create function public.challenges_wait_for_payment() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if (select auth.role()) = 'authenticated' and old.payment_status = 'awaiting'
     and new.outcome is distinct from old.outcome then
    raise exception 'challenge_awaiting_payment' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger challenges_wait_for_payment before update of outcome on public.challenges
  for each row execute function public.challenges_wait_for_payment();

revoke execute on function public.challenges_wait_for_payment() from public, anon, authenticated;
