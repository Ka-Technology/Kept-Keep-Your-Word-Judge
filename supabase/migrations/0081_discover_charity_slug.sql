-- A backer reading a public challenge can open its charity's Every.org page: discover_challenges() (0039) also
-- returns the charity's slug. Nothing else about it changes.
drop function public.discover_challenges(uuid);
create function public.discover_challenges(challenge uuid default null)
  returns table (id uuid, habit_id text, habit text, language text, level text,
                 length_days int, start_date date, time_zone text, day_offset int, charity text,
                 check_ins jsonb, shield_purchases jsonb, total_cents int, pledgers int, charity_slug text)
  language sql stable security definer set search_path = ''
  as $$
    select c.id, c.habit_id, h.name, c.language, c.level,
           c.length_days, c.start_date, c.time_zone, c.day_offset, ch.name,
           coalesce((select jsonb_agg(jsonb_build_object('day', ci.day, 'status', ci.status) order by ci.day)
                     from public.check_ins ci where ci.challenge_id = c.id), '[]'::jsonb),
           coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'price_cents', s.price_cents) order by s.nth)
                     from public.shield_purchases s where s.challenge_id = c.id), '[]'::jsonb),
           coalesce((select sum(p.amount_cents) from public.pledges p where p.challenge_id = c.id), 0)::int,
           (select count(*) from public.pledges p where p.challenge_id = c.id)::int,
           ch.slug
    from public.challenges c
    join public.habits h on h.id = c.habit_id
    join public.charities ch on ch.id = c.charity_id
    where c.outcome is null
      and c.user_id <> (select auth.uid())
      and (challenge is null or c.id = challenge)
      and not public.blocked_between((select auth.uid()), c.user_id)
      and not exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and least(f.requester_id, f.addressee_id) = least((select auth.uid()), c.user_id)
          and greatest(f.requester_id, f.addressee_id) = greatest((select auth.uid()), c.user_id)
      )
      and (c.is_public or exists (
        select 1 from public.pledges mine
        where mine.challenge_id = c.id and mine.pledger_id = (select auth.uid()) and mine.kind = 'backer'
      ))
    order by c.created_at desc
  $$;

revoke execute on function public.discover_challenges(uuid) from public, anon;
grant execute on function public.discover_challenges(uuid) to authenticated;
