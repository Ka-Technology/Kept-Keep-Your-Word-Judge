-- Only friends who back a challenge check its days (T60; owner, 2026-09-29; SPEC.md open question
-- 13, option b). A reviewer must now also have a pledge on the challenge, on top of 0014's rule
-- (an accepted friend from before Day 1), so a friend who approves has money behind the challenger.
-- Withdrawing the pledge (Day 1 only) ends the right to review. No friend can reject, as before, so
-- a pledger can never fail a day to get their pledge back. can_review() is the one rule the review
-- policy, the check-in trigger and check_ins_to_review() share; review_push_tokens() repeats it
-- for the push. Proven by supabase/tests/verification_rls.sql and notifications_rls.sql.

-- 0014's rule, plus the caller's own pledge (readable to them through "own pledges read").
create or replace function public.can_review(challenge uuid) returns boolean
  language sql stable set search_path = ''
  as $$
    select exists (
      select 1
      from public.challenges c
      join public.friendships f
        on f.status = 'accepted'
       and least(f.requester_id, f.addressee_id) = least((select auth.uid()), c.user_id)
       and greatest(f.requester_id, f.addressee_id) = greatest((select auth.uid()), c.user_id)
      join public.pledges p
        on p.challenge_id = c.id
       and p.pledger_id = (select auth.uid())
      where c.id = challenge
        and c.user_id <> (select auth.uid())
        and f.accepted_at < (c.start_date::timestamp at time zone c.time_zone)
    )
  $$;

-- 0028's push list, with the same pledge rule as can_review().
create or replace function public.review_push_tokens(check_in uuid) returns table (token text)
  language sql stable security definer set search_path = ''
  as $$
    select t.token
    from public.check_ins ci
    join public.challenges c on c.id = ci.challenge_id
    join public.friendships f
      on f.status = 'accepted'
     and c.user_id in (f.requester_id, f.addressee_id)
     and f.accepted_at < (c.start_date::timestamp at time zone c.time_zone)
    join public.pledges p
      on p.challenge_id = c.id
     and p.pledger_id = case when f.requester_id = c.user_id then f.addressee_id else f.requester_id end
    join public.push_tokens t
      on t.user_id = p.pledger_id
     and t.reviews
    where ci.id = check_in
  $$;

-- `create or replace` keeps each function's grants (0014, 0028); restated so this file stands alone.
revoke execute on function public.can_review(uuid) from public, anon;
grant execute on function public.can_review(uuid) to authenticated;
revoke execute on function public.review_push_tokens(uuid) from public, anon, authenticated;
grant execute on function public.review_push_tokens(uuid) to service_role;
