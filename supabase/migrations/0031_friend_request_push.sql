-- Push notifications, part 4 (T56, SPEC-notifications.md section 4): the person asked hears about a
-- friend request. Proven by supabase/tests/notifications_rls.sql.

-- "Friend requests", per phone.
alter table public.push_tokens add column friends boolean not null default true;
grant update (friends) on public.push_tokens to authenticated;

-- A new request only: accepting, declining, cancelling or unfriending says nothing. A declined
-- request can be sent again, and pushes again, until T53's block stops that person.
create function public.friendships_notify() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    perform public.call_notify(jsonb_build_object('friend_request', new.id));
    return null;
  end
  $$;

revoke execute on function public.friendships_notify() from public, anon, authenticated;

create trigger friendships_notify after insert on public.friendships
  for each row execute function public.friendships_notify();
