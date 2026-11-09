-- Finishers are rewarded (T188; plan.md decisions 143 and 144; SPEC-pledges.md decision 13). When a
-- challenger finishes, each pledge becomes their reward unless its pledger chose the charity
-- (`to_charity_on_finish`), which can change until the end of Day 1, like a withdrawal. A failure is
-- unchanged. record_donations() follows the new rule, and record_payouts(), the SQL twin of payouts() in
-- challenge-rules.ts, writes the money that leaves Kept to a person: each stake or pledge back to whoever
-- paid it, and each reward. Nothing moves yet: T93 refunds cards, T189 adds Kept balance, T190 pays out
-- through Connect. Only challenges that end from now on get payout rows; earlier ones moved no money.
-- A reward row never shows its giver to the challenger, so a backer stays anonymous (decision 8).
-- Proven by supabase/tests/payouts_rls.sql, with donations_rls.sql updated for the new rule.

-- ── The pledger's choice ──────────────────────────────────────────────────────────────────────────

-- Pledges made before today were promised to the charity on a finish, so they keep that. The default
-- stays true for builds older than this one, which don't send the choice and still say "goes to the
-- charity"; this build always sends it, with the reward (false) preselected.
-- ponytail: flip the default to false once no build older than T188 can pledge.
alter table public.pledges add column to_charity_on_finish boolean not null default true;

grant insert (to_charity_on_finish) on public.pledges to authenticated;
grant update (to_charity_on_finish) on public.pledges to authenticated;

-- 0022's rules, plus: where the pledge goes on a finish can change only until the end of Day 1.
create or replace function public.pledges_before_update() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if (select auth.role()) is distinct from 'authenticated' then return new; end if;
  if new.amount_cents < old.amount_cents then raise exception 'pledge_only_raise'; end if;
  if old.donate_if_not_finished and not new.donate_if_not_finished then raise exception 'pledge_donate_stays_on'; end if;
  if new.to_charity_on_finish is distinct from old.to_charity_on_finish and not public.pledge_withdrawable(new.challenge_id) then
    raise exception 'pledge_choice_fixed';
  end if;
  if new.amount_cents > old.amount_cents then
    if (select outcome from public.challenges where id = new.challenge_id) is not null then
      raise exception 'pledge_challenge_ended';
    end if;
    if (select coalesce(sum(p.amount_cents), 0) from public.pledges p join public.challenges pc on pc.id = p.challenge_id
        where p.pledger_id = new.pledger_id and pc.outcome is null) - old.amount_cents + new.amount_cents > 30000 then
      raise exception 'pledge_outstanding_limit';
    end if;
  end if;
  return new;
end $$;

-- ── Donations: a finished challenge's pledge goes to the charity only if its pledger chose that ─────

create or replace function public.record_donations(challenge uuid) returns void
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
      select c.user_id, 'shield', sum(s.charity_cents)::int from c join public.shield_purchases s on s.challenge_id = c.id
        group by c.user_id
      union all
      select p.pledger_id, 'pledge', p.amount_cents from c join public.pledges p on p.challenge_id = c.id
        where (c.outcome = 'finished' and p.to_charity_on_finish) or (c.outcome = 'not_finished' and p.donate_if_not_finished)
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

-- ── Payouts: money back, and the finisher's reward ────────────────────────────────────────────────

create table public.payouts (
  id           uuid primary key default gen_random_uuid(),
  -- Who receives it: whoever paid it, or the finisher for a reward.
  user_id      uuid not null references auth.users on delete cascade,
  -- Set null if the challenge goes (its challenger deleted their account): the receiver's record stays.
  challenge_id uuid references public.challenges on delete set null,
  -- Whose money it was. Never readable by the app, so a challenger can't learn a backer's id.
  giver_id     uuid references auth.users on delete set null,
  source       text not null check (source in ('stake', 'pledge')),
  kind         text not null check (kind in ('return', 'reward')),
  amount_cents int  not null check (amount_cents > 0),
  -- 'due' until money moves (T93, T189, T190); only a due row can still change or go.
  status       text not null default 'due' check (status in ('due', 'sent', 'paid', 'failed')),
  -- The habit it came from, kept on the row so the record reads the same after the challenge is gone.
  habit        text not null,
  created_at   timestamptz not null default now(),
  unique (challenge_id, giver_id, source)
);
create index payouts_user_id on public.payouts (user_id);

alter table public.payouts enable row level security;
revoke all on public.payouts from anon, authenticated;
grant select (id, user_id, challenge_id, source, kind, amount_cents, status, habit, created_at) on public.payouts to authenticated;

create policy "own payouts read" on public.payouts
  for select to authenticated using (user_id = (select auth.uid()));

-- The twin of payouts() in challenge-rules.ts. Runs whenever record_donations() does, so together they
-- always account for the whole stake and every pledge. A row that already moved money is never changed.
create function public.record_payouts(challenge uuid) returns void
  language sql security definer set search_path = ''
  as $$
    with c as (
      select ch.id, ch.user_id, ch.stake_cents, ch.outcome,
             h.name || coalesce(' (' || initcap(ch.language) || ')', '') as habit
      from public.challenges ch join public.habits h on h.id = ch.habit_id
      where ch.id = challenge
    ),
    due as (
      select c.user_id as user_id, c.user_id as giver_id, 'stake' as source, 'return' as kind, c.stake_cents as amount_cents
        from c where c.outcome in ('finished', 'cancelled')
      union all
      select c.user_id, p.pledger_id, 'pledge', 'reward', p.amount_cents from c join public.pledges p on p.challenge_id = c.id
        where c.outcome = 'finished' and not p.to_charity_on_finish
      union all
      select p.pledger_id, p.pledger_id, 'pledge', 'return', p.amount_cents from c join public.pledges p on p.challenge_id = c.id
        where c.outcome = 'cancelled' or (c.outcome = 'not_finished' and not p.donate_if_not_finished)
    ),
    gone as (
      delete from public.payouts o where o.challenge_id = challenge and o.status = 'due'
        and not exists (select 1 from due where due.giver_id = o.giver_id and due.source = o.source)
    )
    insert into public.payouts (user_id, challenge_id, giver_id, source, kind, amount_cents, habit)
    select due.user_id, c.id, due.giver_id, due.source, due.kind, due.amount_cents, c.habit from due, c
    on conflict (challenge_id, giver_id, source) do update
      set user_id = excluded.user_id, kind = excluded.kind, amount_cents = excluded.amount_cents
      where public.payouts.status = 'due'
  $$;

-- 0033's trigger function now records payouts too; its triggers fire on an outcome, a pledge's
-- choices, and a gift.
create or replace function public.donations_after_change() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  declare
    challenge uuid;
  begin
    -- An if, not a case: `new` has no challenge_id on challenges, and PL/pgSQL reads every field a case names.
    if tg_table_name = 'challenges' then challenge := new.id; else challenge := new.challenge_id; end if;
    perform public.record_donations(challenge);
    perform public.record_payouts(challenge);
    return null;
  end
  $$;

drop trigger pledges_donations on public.pledges;
create trigger pledges_donations after update of donate_if_not_finished, to_charity_on_finish on public.pledges
  for each row execute function public.donations_after_change();

-- ── What the app reads: the choice on each pledge ─────────────────────────────────────────────────

drop function public.challenge_pledges(uuid);
create function public.challenge_pledges(challenge uuid)
  returns table (kind text, username text, avatar_path text, backer text, amount_cents int, donate_if_not_finished boolean,
                 to_charity_on_finish boolean)
  language sql stable security definer set search_path = ''
  as $$
    select q.kind, q.username, q.avatar_path,
           case when q.kind = 'backer' then 'Backer ' || case when q.n <= 26 then chr(64 + q.n) else q.n::text end end,
           q.amount_cents, q.donate_if_not_finished, q.to_charity_on_finish
    from (
      select p.kind, p.amount_cents, p.donate_if_not_finished, p.to_charity_on_finish, p.created_at,
             case when p.kind = 'supporter' then pr.username end as username,
             case when p.kind = 'supporter' then pr.avatar_path end as avatar_path,
             row_number() over (partition by p.kind order by p.created_at, p.id)::int as n
      from public.pledges p
      join public.challenges c on c.id = p.challenge_id
      left join public.profiles pr on pr.id = p.pledger_id
      where p.challenge_id = challenge and c.user_id = (select auth.uid())
    ) q
    order by q.created_at
  $$;

drop function public.my_pledges();
create function public.my_pledges()
  returns table (challenge_id uuid, kind text, amount_cents int, donate_if_not_finished boolean, to_charity_on_finish boolean,
                 challenger text, habit text, charity text, outcome text, withdrawable boolean)
  language sql stable security definer set search_path = ''
  as $$
    select p.challenge_id, p.kind, p.amount_cents, p.donate_if_not_finished, p.to_charity_on_finish,
           case when p.kind = 'supporter' then pr.username end, h.name, ch.name, c.outcome,
           c.outcome is null and public.challenge_day(c) <= 1
    from public.pledges p
    join public.challenges c on c.id = p.challenge_id
    join public.profiles pr on pr.id = c.user_id
    join public.habits h on h.id = c.habit_id
    join public.charities ch on ch.id = c.charity_id
    where p.pledger_id = (select auth.uid())
    order by p.created_at desc
  $$;

revoke execute on function public.record_payouts(uuid), public.donations_after_change(), public.pledges_before_update(),
  public.record_donations(uuid) from public, anon, authenticated;
revoke execute on function public.challenge_pledges(uuid), public.my_pledges() from public, anon;
grant execute on function public.challenge_pledges(uuid), public.my_pledges() to authenticated;
