-- The donation record (T62; SPEC-pledges.md, "The donation route"). One row per giver, source and
-- challenge: who gave, to which charity, how much, from what (the challenger's stake, a pledge or an
-- extra gift) and the habit it backed. The database writes the rows itself whenever an ending
-- changes what goes to the charity; the app only reads its own. record_donations() is the SQL twin
-- of donations() in src/lib/challenge-rules.ts and must agree with it. Pretend money in the demo:
-- `payments` sends each row through the donation partner. Proven by supabase/tests/donations_rls.sql.

create table public.donations (
  id           uuid primary key default gen_random_uuid(),
  giver_id     uuid not null references auth.users on delete cascade,
  -- Set null if the challenge goes (its challenger deleted their account): the giver's record stays.
  challenge_id uuid references public.challenges on delete set null,
  charity_id   text not null references public.charities,
  source       text not null check (source in ('stake', 'pledge', 'gift')),
  amount_cents int  not null check (amount_cents > 0),
  -- The habit it backed, kept on the row so the record reads the same after the challenge is gone.
  habit        text not null,
  created_at   timestamptz not null default now(),
  unique (challenge_id, giver_id, source)
);
create index donations_giver_id on public.donations (giver_id);

alter table public.donations enable row level security;
revoke all on public.donations from anon, authenticated;
grant select on public.donations to authenticated;

create policy "own donations read" on public.donations
  for select to authenticated using (giver_id = (select auth.uid()));

-- Brings a challenge's rows in line with its ending, like donations(): the stake when it isn't
-- finished; each pledge on a finish, or on a failure if its pledger chose to donate (none on a
-- cancel); every extra gift once it has ended. Rows no longer due go, the rest keep their date.
create function public.record_donations(challenge uuid) returns void
  language sql security definer set search_path = ''
  as $$
    with c as (
      select ch.id, ch.user_id, ch.charity_id, ch.stake_cents, ch.outcome,
             h.name || coalesce(' (' || initcap(ch.language) || ')', '') as habit
      from public.challenges ch join public.habits h on h.id = ch.habit_id
      where ch.id = challenge
    ),
    due as (
      select c.user_id as giver_id, 'stake' as source, c.stake_cents as amount_cents from c where c.outcome = 'not_finished'
      union all
      select p.pledger_id, 'pledge', p.amount_cents from c join public.pledges p on p.challenge_id = c.id
        where c.outcome = 'finished' or (c.outcome = 'not_finished' and p.donate_if_not_finished)
      union all
      select g.giver_id, 'gift', g.amount_cents from c join public.extra_gifts g on g.challenge_id = c.id
        where c.outcome is not null
    ),
    gone as (
      delete from public.donations d where d.challenge_id = challenge
        and not exists (select 1 from due where due.giver_id = d.giver_id and due.source = d.source)
    )
    insert into public.donations (giver_id, challenge_id, charity_id, source, amount_cents, habit)
    select due.giver_id, c.id, c.charity_id, due.source, due.amount_cents, c.habit from due, c
    on conflict (challenge_id, giver_id, source) do update set amount_cents = excluded.amount_cents
  $$;

-- What changes the rows: an outcome recorded or cleared; a pledge's "donate either way" turned on
-- after a failure; a gift added or raised. Not deletes: a challenge deleted with its challenger's
-- account cascades to its pledges, and the pledgers' rows must stay.
create function public.donations_after_change() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if tg_table_name = 'challenges' then
      perform public.record_donations(new.id);
    else
      perform public.record_donations(new.challenge_id);
    end if;
    return null;
  end
  $$;

create trigger challenges_donations after update of outcome on public.challenges
  for each row execute function public.donations_after_change();
create trigger pledges_donations after update of donate_if_not_finished on public.pledges
  for each row execute function public.donations_after_change();
create trigger extra_gifts_donations after insert or update of amount_cents on public.extra_gifts
  for each row execute function public.donations_after_change();

revoke execute on function public.record_donations(uuid), public.donations_after_change() from public, anon, authenticated;

-- Challenges that ended before this migration get their rows now.
select public.record_donations(id) from public.challenges where outcome is not null;
