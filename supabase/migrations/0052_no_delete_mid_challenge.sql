-- No deleting an account mid-challenge (owner, 2026-10-18; plan.md decision 103, SPEC-identity.md):
-- delete_account() refuses while the caller has a challenge that hasn't ended (outcome still null:
-- upcoming, running, or a finish waiting for its days to be decided) or a pledge on one, since money
-- is promised on it. Deleting would walk away from a stake or a backing. Cancelling (while it's
-- allowed), finishing or ending it frees the account; free trackers never block. The app asks the
-- same before it deletes anything (lib/delete-account.ts), so photos and sign-ins aren't removed first.
-- Proven by supabase/tests/delete_account_rls.sql.

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
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
