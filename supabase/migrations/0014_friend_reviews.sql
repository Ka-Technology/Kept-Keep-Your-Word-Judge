-- Verification, part 2 (T26, SPEC-verification.md): an eligible friend approves a check-in or
-- sends it to the AI with a note. No friend can reject, so a friend who pledged can never fail a
-- day to get their pledge back (plan.md open question 2). Only friends from before the
-- challenge's Day 1 may review (SPEC.md open question 13, the demo's rule).

alter table public.check_ins
  add column reviewer_id uuid references auth.users on delete set null,
  add column reviewed_at timestamptz,
  add column flag_note   text check (char_length(flag_note) <= 500);

create index check_ins_reviewer on public.check_ins (reviewer_id);

-- Whether the caller may review this challenge's check-ins: an accepted friend of the challenger,
-- accepted before Day 1 began (local midnight of start_date). Runs as the caller, so it only sees
-- what the caller may read.
create function public.can_review(challenge uuid) returns boolean
  language sql stable set search_path = ''
  as $$
    select exists (
      select 1
      from public.challenges c
      join public.friendships f
        on f.status = 'accepted'
       and least(f.requester_id, f.addressee_id) = least((select auth.uid()), c.user_id)
       and greatest(f.requester_id, f.addressee_id) = greatest((select auth.uid()), c.user_id)
      where c.id = challenge
        and c.user_id <> (select auth.uid())
        and f.accepted_at < (c.start_date::timestamp at time zone c.time_zone)
    )
  $$;

-- Who may change a check-in (SPEC-verification.md's table), now with the friend's part. The AI
-- job (service role) and the owner (the dashboard, with no user at all) aren't `authenticated`;
-- T27-T29 pin their changes here.
create or replace function public.check_ins_before_update() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  me uuid := (select auth.uid());
begin
  if (select auth.role()) is distinct from 'authenticated' then
    return new;
  end if;
  if exists (select 1 from public.challenges where id = new.challenge_id and user_id = me) then
    -- The challenger: a new photo while pending (#2), or after the AI asked for one (#11).
    if new.photo_path is not null and new.photo_path is distinct from old.photo_path
       and old.status in ('pending', 'retake') and new.status = 'pending'
       and new.flag_note is not distinct from old.flag_note then
      return new;
    end if;
  elsif public.can_review(new.challenge_id) then
    -- An eligible friend: approve (#3), or send it to the AI with an optional note (#4). Never reject.
    if old.status = 'pending' and new.status in ('approved', 'flagged')
       and new.photo_path is not distinct from old.photo_path
       and (new.status = 'flagged' or new.flag_note is not distinct from old.flag_note) then
      new.reviewer_id := me;
      new.reviewed_at := now();
      return new;
    end if;
  end if;
  raise exception 'check_in_change_not_allowed' using errcode = '23514';
end $$;

grant update (flag_note) on public.check_ins to authenticated;

create policy "friends review check-ins" on public.check_ins
  for update to authenticated
  using (public.can_review(challenge_id)) with check (public.can_review(challenge_id));

-- Friends' check-ins waiting for the caller's review: the Check in tab's "Needs your review".
-- Runs as the caller, so row-level security still decides what's readable.
create function public.check_ins_to_review()
  returns table (check_in_id uuid, challenger_id uuid, habit_name text, check_summary text, day int,
                 photo_path text, photo_taken_at timestamptz, book text, pages text, time_zone text)
  language sql stable set search_path = ''
  as $$
    select ci.id, c.user_id, h.name, h.check_summary, ci.day, ci.photo_path, ci.photo_taken_at, ci.book, ci.pages, c.time_zone
    from public.check_ins ci
    join public.challenges c on c.id = ci.challenge_id
    join public.habits h on h.id = c.habit_id
    where ci.status = 'pending' and public.can_review(c.id)
    order by ci.created_at
  $$;

revoke execute on function public.can_review(uuid), public.check_ins_to_review() from public, anon;
grant execute on function public.can_review(uuid), public.check_ins_to_review() to authenticated;
