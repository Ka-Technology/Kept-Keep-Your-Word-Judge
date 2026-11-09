-- Extra gifts at the end (T32; SPEC-pledges.md decision 11). Once a challenge has ended, its
-- challenger and each pledger can add one extra gift to its charity, whole dollars from $1 to
-- $100, and raise it later. It goes to the charity either way (settle() in challenge-rules.ts).
-- People read their own gift rows; the total reaches the challenger and pledgers through
-- extra_gift_summary(). Must match src/lib/pledges.ts. Proven by supabase/tests/pledges_rls.sql.

create table public.extra_gifts (
  id           uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges on delete cascade,
  giver_id     uuid not null default auth.uid() references auth.users on delete cascade,
  amount_cents int  not null check (amount_cents between 100 and 10000 and amount_cents % 100 = 0),
  created_at   timestamptz not null default now(),
  unique (challenge_id, giver_id)
);
create index extra_gifts_giver_id on public.extra_gifts (giver_id);

alter table public.extra_gifts enable row level security;

-- Whether a person may give on a challenge: its challenger, or someone who pledged on it.
create function public.may_give(challenge uuid, person uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (select 1 from public.challenges c where c.id = challenge and c.user_id = person)
        or exists (select 1 from public.pledges p where p.challenge_id = challenge and p.pledger_id = person)
  $$;

-- Before each gift: only once the challenge has ended, and only from its challenger or a pledger.
create function public.extra_gifts_before_insert() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if not public.may_give(new.challenge_id, new.giver_id) then raise exception 'gift_not_allowed'; end if;
  if (select outcome from public.challenges where id = new.challenge_id) is null then
    raise exception 'gift_challenge_running';
  end if;
  new.created_at := now();
  return new;
end $$;

-- A gift is only ever raised. The owner (dashboard) and server jobs can correct anything.
create function public.extra_gifts_before_update() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if (select auth.role()) is distinct from 'authenticated' then return new; end if;
  if new.amount_cents < old.amount_cents then raise exception 'gift_only_raise'; end if;
  return new;
end $$;

create trigger extra_gifts_before_insert before insert on public.extra_gifts
  for each row execute function public.extra_gifts_before_insert();
create trigger extra_gifts_before_update before update on public.extra_gifts
  for each row execute function public.extra_gifts_before_update();

revoke all on public.extra_gifts from anon, authenticated;
grant select on public.extra_gifts to authenticated;
grant insert (challenge_id, amount_cents) on public.extra_gifts to authenticated;
grant update (amount_cents) on public.extra_gifts to authenticated;

create policy "own gifts read" on public.extra_gifts
  for select to authenticated using (giver_id = (select auth.uid()));
create policy "give as yourself" on public.extra_gifts
  for insert to authenticated with check (giver_id = (select auth.uid()));
create policy "own gifts update" on public.extra_gifts
  for update to authenticated using (giver_id = (select auth.uid())) with check (giver_id = (select auth.uid()));

-- The gift total and number of givers on a challenge, for its challenger and its pledgers.
create function public.extra_gift_summary(challenge uuid)
  returns table (total_cents int, givers int)
  language sql stable security definer set search_path = ''
  as $$
    select coalesce(sum(g.amount_cents), 0)::int, count(g.id)::int
    from public.extra_gifts g
    where g.challenge_id = challenge
    having public.may_give(challenge, (select auth.uid()))
  $$;

revoke execute on function public.extra_gifts_before_insert(), public.extra_gifts_before_update(), public.may_give(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.extra_gift_summary(uuid) from public, anon;
grant execute on function public.extra_gift_summary(uuid) to authenticated;
