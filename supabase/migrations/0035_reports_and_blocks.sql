-- Report and block (T53; SPEC-friends.md, "Reports and blocks"; App Review guideline 1.2 and the
-- TAKE IT DOWN Act's 48-hour removal). Owner decisions of 2026-09-30: each report pushes to the
-- owner's phone, and profile photos get no automatic check for now (the word filter covers
-- usernames and notes).
--
-- Reports: anyone signed in can report a person, a check-in or a public challenge, with a reason and
-- an optional note. The database fills in who was reported, so a backer reporting a public
-- challenge never learns who it is. App users can't read reports back; the owner reads them in the
-- dashboard. Each one queues a push to the owners in kept_owners (the notify function).
--
-- Blocks: blocking someone ends any friendship or request between you and hides you from each
-- other both ways: find_user(), person_preview() and Discover return nothing, and requests and
-- pledges between you are refused. They aren't told; to them your username just isn't found. A
-- block made from a public challenge is anonymous: Blocked accounts never shows who it is. Blocks
-- are reached only through functions, so no one can read another person's blocks or learn who
-- blocked them. Unblocking restores no friendship or request.
--
-- The word filter: objectionable() refuses usernames, flag notes and appeal notes containing a word
-- on its list, as whole words, so "scunthorpe" passes. Must match OBJECTIONABLE_WORDS in
-- src/lib/moderation.ts (tested). Proven by supabase/tests/reports_rls.sql.

-- ── Blocks ──────────────────────────────────────────────────────────────────────────────────────

create table public.blocks (
  id         uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users on delete cascade,
  blocked_id uuid not null references auth.users on delete cascade,
  -- Made from an anonymous public challenge: the blocker never learns who it is.
  anonymous  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
create index blocks_blocked_id on public.blocks (blocked_id);

alter table public.blocks enable row level security;
revoke all on public.blocks from anon, authenticated;

-- Whether either of two people has blocked the other. Only definer functions and triggers call it.
create function public.blocked_between(a uuid, b uuid) returns boolean
  language sql stable set search_path = ''
  as $$
    select exists (select 1 from public.blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
  $$;

-- Ends everything between the caller and `person`, then records the block.
create function public.block_person(person uuid, is_anonymous boolean) returns void
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if person = (select auth.uid()) then raise exception 'block_self'; end if;
    insert into public.blocks (blocker_id, blocked_id, anonymous) values ((select auth.uid()), person, is_anonymous)
      on conflict (blocker_id, blocked_id) do update set anonymous = public.blocks.anonymous and excluded.anonymous;
    delete from public.friendships f
      where least(f.requester_id, f.addressee_id) = least((select auth.uid()), person)
        and greatest(f.requester_id, f.addressee_id) = greatest((select auth.uid()), person);
  end
  $$;

-- Block someone the caller knows by name: from a friend's profile or a friend request.
create function public.block_user(person uuid) returns void
  language sql security definer set search_path = ''
  as $$ select public.block_person(person, false) $$;

-- Block a challenge's challenger: from a check-in under review, or a public challenge on Discover,
-- where the caller may not know who it is (anonymous unless they're friends).
create function public.block_challenger(challenge uuid) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    owner uuid := (select c.user_id from public.challenges c where c.id = challenge);
  begin
    if owner is null then raise exception 'block_no_challenge'; end if;
    perform public.block_person(owner, not exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and least(f.requester_id, f.addressee_id) = least((select auth.uid()), owner)
        and greatest(f.requester_id, f.addressee_id) = greatest((select auth.uid()), owner)
    ));
  end
  $$;

-- Settings → Privacy & security → Blocked accounts: the caller's blocks, newest first. An
-- anonymous block shows no username or photo, and no block shows an id.
create function public.my_blocks()
  returns table (id uuid, username text, avatar_path text, anonymous boolean, created_at timestamptz)
  language sql stable security definer set search_path = ''
  as $$
    select b.id, case when b.anonymous then null else p.username end, case when b.anonymous then null else p.avatar_path end,
           b.anonymous, b.created_at
    from public.blocks b left join public.profiles p on p.id = b.blocked_id
    where b.blocker_id = (select auth.uid())
    order by b.created_at desc
  $$;

-- Unblock: only the caller's own block. Nothing else comes back.
create function public.unblock(block uuid) returns void
  language sql security definer set search_path = ''
  as $$ delete from public.blocks b where b.id = block and b.blocker_id = (select auth.uid()) $$;

-- A request between two people with a block either way is refused (and so never pushed, T56).
create function public.friendships_block_rule() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if public.blocked_between(new.requester_id, new.addressee_id) then raise exception 'friendship_not_allowed'; end if;
    return new;
  end
  $$;

create trigger friendships_block_rule before insert on public.friendships
  for each row execute function public.friendships_block_rule();

-- 0009's search, now blind to anyone in a block with the caller.
create or replace function public.find_user(name text)
  returns table (id uuid, username text, avatar_path text)
  language sql stable security definer set search_path = ''
  as $$
    select p.id, p.username, p.avatar_path from public.profiles p
    where p.username = name and not public.blocked_between((select auth.uid()), p.id)
    limit 1
  $$;

-- 0034's preview, likewise.
create or replace function public.person_preview(name text)
  returns table (id uuid, username text, avatar_path text, member_since date, mutual_count int, mutual_names text[])
  language sql stable security definer set search_path = ''
  as $$
    with t as (
      select p.id, p.username, p.avatar_path, p.created_at from public.profiles p
      where p.username = name and not public.blocked_between((select auth.uid()), p.id)
      limit 1
    ),
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

-- 0027's public list, without challenges from anyone in a block with the caller.
create or replace function public.discover_challenges(challenge uuid default null)
  returns table (id uuid, habit_id text, habit text, language text, level text,
                 length_days int, start_date date, time_zone text, day_offset int, charity text,
                 check_ins jsonb, total_cents int, pledgers int)
  language sql stable security definer set search_path = ''
  as $$
    select c.id, c.habit_id, h.name, c.language, c.level,
           c.length_days, c.start_date, c.time_zone, c.day_offset, ch.name,
           coalesce((select jsonb_agg(jsonb_build_object('day', ci.day, 'status', ci.status) order by ci.day)
                     from public.check_ins ci where ci.challenge_id = c.id), '[]'::jsonb),
           coalesce((select sum(p.amount_cents) from public.pledges p where p.challenge_id = c.id), 0)::int,
           (select count(*) from public.pledges p where p.challenge_id = c.id)::int
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

-- 0025's pledge rule, refusing a pledge between two people with a block either way.
create or replace function public.pledges_before_insert() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  c public.challenges;
begin
  select * into c from public.challenges where id = new.challenge_id;
  if not found then raise exception 'pledge_no_challenge'; end if;
  if c.user_id = new.pledger_id then raise exception 'pledge_own_challenge'; end if;
  if public.blocked_between(new.pledger_id, c.user_id) then raise exception 'pledge_not_allowed'; end if;
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

-- ── Reports ─────────────────────────────────────────────────────────────────────────────────────

-- Who hears about reports: the owner's account. Readable by no app user.
create table public.kept_owners (
  user_id uuid primary key references auth.users on delete cascade
);
alter table public.kept_owners enable row level security;
revoke all on public.kept_owners from anon, authenticated;
insert into public.kept_owners (user_id) select id from public.profiles where username = 'mr.kangs';

create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  -- Kept when either account is deleted, so the owner can still act on the report.
  reporter_id  uuid default auth.uid() references auth.users on delete set null,
  reported_id  uuid references auth.users on delete set null,
  check_in_id  uuid references public.check_ins on delete set null,
  challenge_id uuid references public.challenges on delete set null,
  reason       text not null check (reason in ('nudity', 'intimate_image', 'harassment', 'hate', 'spam', 'other')),
  note         text check (char_length(note) <= 500),
  created_at   timestamptz not null default now(),
  -- The owner's: when it was dealt with, and how.
  resolved_at  timestamptz,
  resolution   text
);
create index reports_open on public.reports (created_at) where resolved_at is null;

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant insert (reported_id, check_in_id, challenge_id, reason, note) on public.reports to authenticated;
create policy "report as yourself" on public.reports
  for insert to authenticated with check (reporter_id = (select auth.uid()));

-- Fills in who was reported from the check-in or challenge (overriding anything sent), and refuses
-- a report of nothing or of yourself.
create function public.reports_before_insert() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if new.check_in_id is not null then
      select c.user_id, c.id into new.reported_id, new.challenge_id
        from public.check_ins ci join public.challenges c on c.id = ci.challenge_id where ci.id = new.check_in_id;
      if not found then raise exception 'report_no_target'; end if;
    elsif new.challenge_id is not null then
      select c.user_id into new.reported_id from public.challenges c where c.id = new.challenge_id;
      if not found then raise exception 'report_no_target'; end if;
    elsif new.reported_id is null then
      raise exception 'report_no_target';
    end if;
    if new.reported_id = new.reporter_id then raise exception 'report_self'; end if;
    new.created_at := now();
    new.resolved_at := null;
    new.resolution := null;
    return new;
  end
  $$;

create trigger reports_before_insert before insert on public.reports
  for each row execute function public.reports_before_insert();

-- Each report pushes to the owners (notify, { report }), the same day, for the 48-hour promise.
create function public.reports_notify() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    perform public.call_notify(jsonb_build_object('report', new.id));
    return null;
  end
  $$;

create trigger reports_notify after insert on public.reports
  for each row execute function public.reports_notify();

-- ── The word filter ─────────────────────────────────────────────────────────────────────────────

-- Whether text contains a word on the list, as a whole word (letters split on anything else).
create function public.objectionable(t text) returns boolean
  language sql immutable set search_path = ''
  as $$
    select coalesce(regexp_split_to_array(lower(t), '[^a-z]+') && array[
      'asshole', 'bastard', 'bitch', 'bullshit', 'chink', 'cock', 'coon', 'cunt', 'dickhead', 'dyke',
      'fag', 'faggot', 'fuck', 'fucker', 'fucking', 'gook', 'kike', 'motherfucker', 'nigga', 'nigger',
      'paki', 'pedo', 'pedophile', 'porn', 'pussy', 'rape', 'rapist', 'retard', 'retarded', 'shit',
      'slut', 'spic', 'tranny', 'twat', 'wank', 'wanker', 'wetback', 'whore'
    ]::text[], false)
  $$;

create function public.objectionable_rule() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    -- One branch per table: a row only has its own table's fields.
    if tg_table_name = 'profiles' then
      if public.objectionable(new.username) then raise exception 'text_objectionable' using errcode = '23514'; end if;
    elsif public.objectionable(new.flag_note) or public.objectionable(new.appeal_note) then
      raise exception 'text_objectionable' using errcode = '23514';
    end if;
    return new;
  end
  $$;

create trigger profiles_objectionable before insert or update of username on public.profiles
  for each row execute function public.objectionable_rule();
create trigger check_ins_objectionable before insert or update of flag_note, appeal_note on public.check_ins
  for each row execute function public.objectionable_rule();

revoke execute on function public.blocked_between(uuid, uuid), public.block_person(uuid, boolean),
  public.friendships_block_rule(), public.reports_before_insert(), public.reports_notify()
  from public, anon, authenticated;
revoke execute on function public.block_user(uuid), public.block_challenger(uuid), public.my_blocks(), public.unblock(uuid)
  from public, anon;
grant execute on function public.block_user(uuid), public.block_challenger(uuid), public.my_blocks(), public.unblock(uuid)
  to authenticated;
