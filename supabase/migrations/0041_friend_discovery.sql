-- Finding friends like Instagram (owner, 2026-10-03; SPEC-friends.md, "How friendship works"):
-- search as you type, and People you may know. Requests still need both sides to agree (0009), and
-- a block either way still hides the two from each other (0035).
--
-- search_users(): usernames that START with what was typed (2 letters or more, any case), up to 20,
-- never the caller. This replaces exact-username-only search, which the owner traded for being
-- easier to find; it returns the same three fields find_user() does, nothing more.
-- suggested_friends(): friends of the caller's friends that the caller has no friendship or request
-- with yet, most friends in common first, up to 20. It reveals only what person_preview() already
-- shows to anyone who types the exact username: that a friend of yours is their friend too.
-- Proven by supabase/tests/friends_rls.sql.

-- ponytail: starts_with() scans profiles (no index use); add a text_pattern_ops index if users reach the tens of thousands.
create function public.search_users(prefix text)
  returns table (id uuid, username text, avatar_path text)
  language sql stable security definer set search_path = ''
  as $$
    -- starts_with, not LIKE: '_' and '.' in a username are letters here, not wildcards.
    select p.id, p.username, p.avatar_path from public.profiles p
    where length(prefix) >= 2
      and starts_with(p.username, lower(prefix))
      and p.id <> (select auth.uid())
      and not public.blocked_between((select auth.uid()), p.id)
    order by p.username
    limit 20
  $$;

create function public.suggested_friends()
  returns table (id uuid, username text, avatar_path text, mutual_count int)
  language sql stable security definer set search_path = ''
  as $$
    with mine as (
      select case when f.requester_id = (select auth.uid()) then f.addressee_id else f.requester_id end as friend
      from public.friendships f
      where f.status = 'accepted' and (select auth.uid()) in (f.requester_id, f.addressee_id)
    ),
    -- Everyone the caller already has a friendship or a request with, either way.
    known as (
      select case when f.requester_id = (select auth.uid()) then f.addressee_id else f.requester_id end as person
      from public.friendships f
      where (select auth.uid()) in (f.requester_id, f.addressee_id)
    ),
    -- Each accepted friend of each of the caller's friends, with the friend they share.
    theirs as (
      select case when f.requester_id = m.friend then f.addressee_id else f.requester_id end as person, m.friend
      from public.friendships f join mine m on m.friend in (f.requester_id, f.addressee_id)
      where f.status = 'accepted'
    )
    select p.id, p.username, p.avatar_path, count(distinct t.friend)::int as mutual_count
    from theirs t join public.profiles p on p.id = t.person
    where t.person <> (select auth.uid())
      and t.person not in (select person from known)
      and not public.blocked_between((select auth.uid()), t.person)
    group by p.id, p.username, p.avatar_path
    order by mutual_count desc, p.username
    limit 20
  $$;

revoke execute on function public.search_users(text), public.suggested_friends() from public, anon;
grant execute on function public.search_users(text), public.suggested_friends() to authenticated;
