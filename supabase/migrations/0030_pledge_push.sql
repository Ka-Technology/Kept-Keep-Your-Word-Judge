-- Push notifications, part 3 (T55, SPEC-notifications.md section 3): the challenger hears when
-- someone pledges behind their challenge. Proven by supabase/tests/notifications_rls.sql.

-- "Someone backs you", per phone.
alter table public.push_tokens add column pledges boolean not null default true;
grant update (pledges) on public.push_tokens to authenticated;

-- A new pledge only: raising or withdrawing one says nothing. The pledge's id goes to notify, which
-- reads who pledged there and never sends a backer's identity on (SPEC-pledges.md decision 8).
create function public.pledges_notify() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    perform public.call_notify(jsonb_build_object('pledge', new.id));
    return null;
  end
  $$;

revoke execute on function public.pledges_notify() from public, anon, authenticated;

create trigger pledges_notify after insert on public.pledges
  for each row execute function public.pledges_notify();
