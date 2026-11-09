-- The preview before a friend request (T58; SPEC-friends.md, "The preview"; owner, 2026-09-29). Both
-- sides check who it is first: the sender after Find, the person asked before Accept. For one exact
-- username it returns the photo and username (as find_user() does), the month they joined Kept, and
-- friends in common: how many, and the first 3 by username. Friends in common are only people who
-- are already accepted friends of both, so nobody's friend list leaks beyond the caller's own
-- friends. Nothing else: no email, date of birth, state, challenges or completion rate. T53 adds
-- blocking, after which a blocked person gets nothing back. Must match memberSinceText() and
-- mutualFriendsText() in src/lib/friends.ts. Proven by supabase/tests/friends_rls.sql.

create function public.person_preview(name text)
  returns table (id uuid, username text, avatar_path text, member_since date, mutual_count int, mutual_names text[])
  language sql stable security definer set search_path = ''
  as $$
    with t as (
      select p.id, p.username, p.avatar_path, p.created_at from public.profiles p where p.username = name limit 1
    ),
    -- The caller's accepted friends, and the target's.
    mine as (
      select case when f.requester_id = (select auth.uid()) then f.addressee_id else f.requester_id end as friend
      from public.friendships f
      where f.status = 'accepted' and (select auth.uid()) in (f.requester_id, f.addressee_id)
    ),
    theirs as (
      select case when f.requester_id = t.id then f.addressee_id else f.requester_id end as friend
      from public.friendships f, t
      where f.status = 'accepted' and t.id in (f.requester_id, f.addressee_id)
    ),
    mutual as (
      select p.username from public.profiles p where p.id in (select friend from mine intersect select friend from theirs)
    )
    select t.id, t.username, t.avatar_path, date_trunc('month', t.created_at at time zone 'UTC')::date,
           (select count(*)::int from mutual),
           coalesce((select array_agg(m.username order by m.username) from (select username from mutual order by username limit 3) m), '{}')
    from t
  $$;

revoke execute on function public.person_preview(text) from public, anon;
grant execute on function public.person_preview(text) to authenticated;
