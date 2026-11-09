-- Backers (T45; SPEC-pledges.md decisions 3, 8–10). Someone who isn't the challenger's friend can
-- pledge on a public challenge during its first 7 days, as a backer; after that, public or not, it
-- takes no new backers. Kept credits aren't stored anywhere: the app works them out from backer
-- pledges on finished challenges (CREDIT_RATES in challenge-rules.ts), so no table or function can
-- withdraw, send or spend them. backed_finished_count() is the backer badge's number, visible to
-- the person and their friends. Must match src/lib/pledges.ts. Proven by supabase/tests/pledges_rls.sql.

-- 0022's rule, with the backer branch (T45).
create or replace function public.pledges_before_insert() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  c public.challenges;
begin
  select * into c from public.challenges where id = new.challenge_id;
  if not found then raise exception 'pledge_no_challenge'; end if;
  if c.user_id = new.pledger_id then raise exception 'pledge_own_challenge'; end if;
  if c.outcome is not null then raise exception 'pledge_challenge_ended'; end if;
  if exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least(new.pledger_id, c.user_id)
      and greatest(f.requester_id, f.addressee_id) = greatest(new.pledger_id, c.user_id)
  ) then
    new.kind := 'supporter';
  elsif not c.is_public then
    raise exception 'pledge_not_friend';
  elsif public.challenge_day(c) > 7 then
    raise exception 'pledge_backer_window';
  else
    new.kind := 'backer';
  end if;
  if (select coalesce(sum(p.amount_cents), 0) from public.pledges p join public.challenges pc on pc.id = p.challenge_id
      where p.pledger_id = new.pledger_id and pc.outcome is null) + new.amount_cents > 30000 then
    raise exception 'pledge_outstanding_limit';
  end if;
  new.created_at := now();
  return new;
end $$;

-- How many finished challenges a person has backed as a backer: the badge's count. Null unless
-- the caller is that person or their accepted friend.
create function public.backed_finished_count(person uuid) returns int
  language sql stable security definer set search_path = ''
  as $$
    select case
      when person = (select auth.uid()) or exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and least(f.requester_id, f.addressee_id) = least((select auth.uid()), person)
          and greatest(f.requester_id, f.addressee_id) = greatest((select auth.uid()), person)
      )
      then (select count(*)::int from public.pledges p join public.challenges c on c.id = p.challenge_id
            where p.pledger_id = person and p.kind = 'backer' and c.outcome = 'finished')
    end
  $$;

revoke execute on function public.pledges_before_insert() from public, anon, authenticated;
revoke execute on function public.backed_finished_count(uuid) from public, anon;
grant execute on function public.backed_finished_count(uuid) to authenticated;
