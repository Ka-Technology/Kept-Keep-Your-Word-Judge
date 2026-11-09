-- No deleting an account with money in Kept (owner, 2026-10-28; plan.md decision 151). Like 0052's rule for
-- money still promised, delete_account() now also refuses while the person has Kept balance, or money coming
-- back that's waiting for their choice (a backed payout, 0063): it's theirs, and deleting the account would
-- lose it. They spend the balance or choose where the money goes first; until cashing a balance out arrives
-- (T190), the app points them to hello@habitkept.com, and the owner sends it back by hand.
-- Kept credits aren't money (they only pay Kept's fee) and still end with the account.
-- Proven by supabase/tests/balance_rls.sql.

create or replace function public.delete_account() returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  if exists (select 1 from public.challenges c where c.user_id = auth.uid() and c.outcome is null)
     or exists (
       select 1 from public.pledges p join public.challenges c on c.id = p.challenge_id
       where p.pledger_id = auth.uid() and c.outcome is null
     ) then
    raise exception 'money_still_promised' using errcode = 'P0001';
  end if;
  if public.balance_cents(auth.uid()) > 0
     or exists (select 1 from public.payouts o where o.user_id = auth.uid() and o.status = 'due' and public.payout_backed(o)) then
    raise exception 'money_in_kept' using errcode = 'P0001';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
