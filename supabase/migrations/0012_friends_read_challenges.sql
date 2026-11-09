-- Friends read each other's challenges and check-ins (T23, SPEC-friends.md): the friend profile's
-- completion rate, success marks and challenges, and later the check-ins friends approve (T26).
-- Only accepted friendships count, and only for reading; unfriending deletes the friendship row,
-- so access ends at once. Strangers still get nothing (public challenges come with T44).

-- least/greatest matches the friendships_pair index, whichever of the two asked.
create policy "friends read challenges" on public.challenges
  for select to authenticated
  using (exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least((select auth.uid()), challenges.user_id)
      and greatest(f.requester_id, f.addressee_id) = greatest((select auth.uid()), challenges.user_id)
  ));

-- A check-in is readable whenever its challenge is: the caller's own, or an accepted friend's.
create policy "friends read check-ins" on public.check_ins
  for select to authenticated
  using (exists (select 1 from public.challenges c where c.id = check_ins.challenge_id));
