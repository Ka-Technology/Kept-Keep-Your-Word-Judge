-- Proves the $1,000 a challenge can take in pledges (migration 0066, T196, plan.md decision 155): a pledge or
-- a raise that brings a challenge to $1,000 exactly goes through, and one dollar past it is refused
-- (`pledge_challenge_full`), for a new pledge, a raise, check_pledge() and the server's own raise alike.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/pledge_cap_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

-- A is the challenger; P1–P11 are strangers who back A's public challenge, each as a backer.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000c00' || lpad(n::text, 2, '0'))::uuid, 'cap-' || n || '@kept.test'
from generate_series(0, 11) as n;

insert into public.profiles (id, username, date_of_birth, state_code)
select ('00000000-0000-4000-8000-0000000c00' || lpad(n::text, 2, '0'))::uuid, 'cap_test_' || n, '1990-01-01', 'OR'
from generate_series(0, 11) as n;

insert into public.challenges (user_id, habit_id, length_days, stake_cents, charity_id, payment_method, time_zone, consented_at, is_public)
values ('00000000-0000-4000-8000-0000000c0000', 'read', 28, 2000, 'msf', 'card', 'America/Los_Angeles', now(), true);

create temporary table cap on commit drop as
  select id from public.challenges where user_id = '00000000-0000-4000-8000-0000000c0000';
grant select on cap to authenticated;

-- P1–P9 pledge $100 each and P10 $95: $995 in all, made as the owner would (no user JWT).
insert into public.pledges (challenge_id, pledger_id, amount_cents)
select (select id from cap), ('00000000-0000-4000-8000-0000000c00' || lpad(n::text, 2, '0'))::uuid,
       case when n = 10 then 9500 else 10000 end
from generate_series(1, 10) as n;

-- As P11: $5 brings it to $1,000 exactly; check_pledge() agrees before and refuses after.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000c0011","role":"authenticated"}', true);

do $$
declare
  ch uuid := (select id from cap);
begin
  begin
    perform public.check_pledge(ch, 600);
    raise exception 'FAIL: check_pledge() passed a pledge one dollar past $1,000';
  exception when raise_exception then
    if sqlerrm <> 'pledge_challenge_full' then raise; end if;
  end;
  perform public.check_pledge(ch, 500);
  insert into public.pledges (challenge_id, amount_cents) values (ch, 500);
  begin
    perform public.check_pledge(ch, 600);
    raise exception 'FAIL: check_pledge() passed a raise on a full challenge';
  exception when raise_exception then
    if sqlerrm <> 'pledge_challenge_full' then raise; end if;
  end;
end $$;

-- As P10: raising $95 to $96 would take it to $1,001.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000c0010","role":"authenticated"}', true);

do $$
begin
  begin
    update public.pledges set amount_cents = 9600 where challenge_id = (select id from cap);
    raise exception 'FAIL: a raise took a challenge past $1,000';
  exception when raise_exception then
    if sqlerrm <> 'pledge_challenge_full' then raise; end if;
  end;
end $$;

-- The server's raise after a card payment (card_charge_succeeded()) is refused too, so the money goes back.
reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  begin
    update public.pledges set amount_cents = 9600
      where challenge_id = (select id from cap) and pledger_id = '00000000-0000-4000-8000-0000000c0010';
    raise exception 'FAIL: the server raised a pledge past $1,000';
  exception when raise_exception then
    if sqlerrm <> 'pledge_challenge_full' then raise; end if;
  end;
  begin
    insert into public.pledges (challenge_id, pledger_id, amount_cents)
      values ((select id from cap), '00000000-0000-4000-8000-0000000c0000', 500);
    raise exception 'FAIL: a pledge went on a full challenge';
  exception when raise_exception then
    -- The challenger's own pledge is refused first; a stranger's is refused as full (below).
    if sqlerrm not in ('pledge_own_challenge', 'pledge_challenge_full') then raise; end if;
  end;
end $$;

-- P11 withdraws its $5 (by the end of Day 1): there's room again, and P10's raise to $100 fits exactly.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000c0011","role":"authenticated"}', true);
delete from public.pledges where challenge_id = (select id from cap);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000c0010","role":"authenticated"}', true);

do $$
begin
  update public.pledges set amount_cents = 10000 where challenge_id = (select id from cap);
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if (select sum(amount_cents) from public.pledges where challenge_id = (select id from cap)) is distinct from 100000 then
    raise exception 'FAIL: a raise to $1,000 exactly didn''t go through';
  end if;
end $$;

rollback;

select 'PASS: a challenge takes at most $1,000 in pledges: new pledges, raises, check_pledge() and the server' as result;
