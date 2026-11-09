-- Friends (T22, SPEC-friends.md): requests by exact username, accepted by the addressee. One row
-- per pair whichever way round; declining, cancelling and unfriending delete it, and deleting an
-- account deletes its friendships. Nothing here returns email, date of birth or state: the
-- profiles select policy stays own-row-only, and the two functions return only id, username and
-- photo. Friends' read access to challenges and check-ins comes with T23.

create table public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null default auth.uid() references auth.users on delete cascade,
  addressee_id uuid not null references auth.users on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  constraint friendships_not_self check (requester_id <> addressee_id),
  -- accepted_at is set exactly when the request is accepted.
  constraint friendships_accepted_at check ((status = 'accepted') = (accepted_at is not null))
);

-- One row per pair, whichever way round, so neither can ask twice.
create unique index friendships_pair on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_requester on public.friendships (requester_id);
create index friendships_addressee on public.friendships (addressee_id);

-- The only change allowed is the addressee accepting: pending -> accepted, which records when.
create function public.friendships_before_update() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if old.status <> 'pending' or new.status <> 'accepted' then
    raise exception 'friendship_not_pending' using errcode = '23514';
  end if;
  new.accepted_at := now();
  return new;
end $$;

create trigger friendships_before_update before update on public.friendships
  for each row execute function public.friendships_before_update();

-- Access: the app sends only the addressee (the requester is the caller) and only ever changes the
-- status. Either person can delete the row (decline, cancel, unfriend).
alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated;
grant select, delete on public.friendships to authenticated;
grant insert (addressee_id) on public.friendships to authenticated;
grant update (status) on public.friendships to authenticated;

create policy "own friendships read" on public.friendships
  for select to authenticated using ((select auth.uid()) in (requester_id, addressee_id));
create policy "request as yourself" on public.friendships
  for insert to authenticated
  with check (requester_id = (select auth.uid()) and exists (select 1 from public.profiles where id = (select auth.uid())));
create policy "addressee accepts" on public.friendships
  for update to authenticated
  using (addressee_id = (select auth.uid())) with check (addressee_id = (select auth.uid()));
create policy "either side deletes" on public.friendships
  for delete to authenticated using ((select auth.uid()) in (requester_id, addressee_id));

-- One user by exact username (usernames are lowercase), for sending a request. Only id, username
-- and photo, which help confirm it's the right person. There's no partial match or list.
create function public.find_user(name text)
  returns table (id uuid, username text, avatar_path text)
  language sql stable security definer set search_path = ''
  as $$ select p.id, p.username, p.avatar_path from public.profiles p where p.username = name limit 1 $$;

-- The caller's friendships, with the other person's username and photo. `direction` says who asked:
-- 'incoming' (they asked the caller) or 'outgoing'.
create function public.my_friends()
  returns table (friendship_id uuid, user_id uuid, username text, avatar_path text, status text, direction text)
  language sql stable security definer set search_path = ''
  as $$
    select f.id, p.id, p.username, p.avatar_path, f.status,
           case when f.requester_id = (select auth.uid()) then 'outgoing' else 'incoming' end
    from public.friendships f
    join public.profiles p
      on p.id = case when f.requester_id = (select auth.uid()) then f.addressee_id else f.requester_id end
    where (select auth.uid()) in (f.requester_id, f.addressee_id)
    order by p.username
  $$;

revoke execute on function public.find_user(text), public.my_friends() from public, anon;
grant execute on function public.find_user(text), public.my_friends() to authenticated;
