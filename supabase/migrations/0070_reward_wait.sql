-- The 14-day wait before a reward can go to a bank (T195; plan.md decision 154; SPEC-payments.md "Safeguards").
-- A reward's Kept balance entry carries the date it can be cashed out, 14 days after its challenge ended: long
-- enough for most fraud warnings and disputes on the pledges in it to arrive (T194). It can be spent inside Kept
-- at once, on a stake or a pledge. Cashing out to a bank (T190) will take only what's past its date; until then
-- my_reward_waits() tells Wallet and the results "Can go to your bank from {date}".
-- Proven by supabase/tests/reward_wait_rls.sql.

alter table public.balance_entries add column cashable_at timestamptz;

-- 0067's, with each reward entry dated.
create or replace function public.rewards_to_balance(challenge uuid) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  o public.payouts;
  ends timestamptz := coalesce((select ended_at from public.challenges where id = challenge), now());
begin
  for o in
    select * from public.payouts p
    where p.challenge_id = challenge and p.kind = 'reward' and p.status = 'due' and public.payout_backed(p)
    for update
  loop
    insert into public.balance_entries (user_id, amount_cents, source, payout_id, key, cashable_at)
      values (o.user_id, o.amount_cents, 'payout', o.id, 'payout:' || o.id, ends + interval '14 days')
      on conflict (key) do nothing;
    update public.payouts set destination = 'balance', status = 'paid' where id = o.id;
  end loop;
end $$;

-- Rewards already in a balance are dated the same way.
update public.balance_entries e set cashable_at = coalesce(c.ended_at, e.created_at) + interval '14 days'
from public.payouts o left join public.challenges c on c.id = o.challenge_id
where e.payout_id = o.id and o.kind = 'reward' and e.source = 'payout';

-- The caller's rewards still inside their 14 days, one per challenge, less what was taken back from them.
create function public.my_reward_waits()
  returns table (challenge_id uuid, habit text, amount_cents int, cashable_at timestamptz)
  language sql stable security definer set search_path = ''
  as $$
    select o.challenge_id, o.habit, sum(e.amount_cents)::int, max(e.cashable_at)
    from public.balance_entries e join public.payouts o on o.id = e.payout_id
    where e.user_id = (select auth.uid()) and o.kind = 'reward' and e.source in ('payout', 'takeback')
    group by o.challenge_id, o.habit
    having max(e.cashable_at) > now() and sum(e.amount_cents) > 0
    order by max(e.cashable_at)
  $$;

revoke execute on function public.rewards_to_balance(uuid), public.my_reward_waits() from public, anon, authenticated;
grant execute on function public.my_reward_waits() to authenticated;
