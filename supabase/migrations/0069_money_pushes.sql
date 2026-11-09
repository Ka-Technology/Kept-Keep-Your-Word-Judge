-- The money pushes (T199; plan.md decision 160; SPEC-notifications.md). `notify` is asked, after the change
-- commits (call_notify(), 0028), whenever a person's own real money moves or waits for them:
--   { reward }         a finish put reward money in their Kept balance ("Your reward is in");
--   { money_waiting }  a backed return waits for their choice when the challenge ends, and again on day 10
--                      ({ reminder: true }, from the hourly cron) ("Money is waiting");
--   { sent_back }      a return reached its card ("Sent back to your card");
--   { takeback }       a pledge in their reward was taken back by its bank (T194, "A pledge was taken back").
-- No push for a payment going through: the person is in the app then. The demo's pretend money asks for nothing,
-- since only real money (payout_backed()) makes a payout wait, and only it reaches a balance or a card.
-- Proven by supabase/tests/money_pushes_rls.sql.

-- Runs after challenges_donations (triggers fire in name order), so rewards_to_balance() has already paid in.
create function public.challenges_money_push() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if exists (select 1 from public.payouts where challenge_id = new.id and kind = 'reward' and destination = 'balance') then
    perform public.call_notify(jsonb_build_object('reward', new.id));
  end if;
  return null;
end $$;
create trigger challenges_money_push after update of outcome on public.challenges
  for each row when (new.outcome = 'finished' and old.outcome is null) execute function public.challenges_money_push();

create function public.payouts_money_push() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if tg_op = 'INSERT' then
    if new.kind = 'return' and new.status = 'due' and public.payout_backed(new) then
      perform public.call_notify(jsonb_build_object('money_waiting', new.id));
    end if;
  elsif new.status = 'paid' and new.destination = 'card' and old.status <> 'paid' then
    perform public.call_notify(jsonb_build_object('sent_back', new.id));
  end if;
  return null;
end $$;
create trigger payouts_money_push after insert or update of status on public.payouts
  for each row execute function public.payouts_money_push();

create function public.balance_takeback_push() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform public.call_notify(jsonb_build_object('takeback', new.id));
  return null;
end $$;
create trigger balance_takeback_push after insert on public.balance_entries
  for each row when (new.source = 'takeback') execute function public.balance_takeback_push();

-- Day 10: each return still waiting, reminded in the hour it turns 10 days old. ponytail: an hour the cron
-- misses skips its reminders; a reminded_at column if that ever matters.
create function public.money_reminders() returns int
  language plpgsql security definer set search_path = ''
  as $$
declare
  o public.payouts;
  n int := 0;
begin
  for o in
    select * from public.payouts p
    where p.status = 'due' and p.kind = 'return' and p.challenge_id is not null
      and p.created_at >= now() - interval '10 days 1 hour' and p.created_at < now() - interval '10 days'
      and public.payout_backed(p)
  loop
    perform public.call_notify(jsonb_build_object('money_waiting', o.id, 'reminder', true));
    n := n + 1;
  end loop;
  return n;
end $$;

-- 0067's hourly job, with the reminders.
select cron.schedule('send-back-unchosen', '23 * * * *', $$ select public.send_back_unchosen(), public.money_reminders() $$);

revoke execute on function public.challenges_money_push(), public.payouts_money_push(), public.balance_takeback_push(),
  public.money_reminders()
  from public, anon, authenticated;
