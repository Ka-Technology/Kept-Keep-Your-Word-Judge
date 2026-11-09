-- Money nobody chooses for (T198; plan.md decision 158; SPEC-payments.md "Kept balance"). Answers open question 9.
-- 1. A reward that real money backs lands in the finisher's Kept balance when the challenge ends: it has no card
--    to go back to, so it no longer waits for a choice. Rewards already waiting move now.
-- 2. A due, backed return nobody chose for goes back to its card 14 days after it was due. Every hour,
--    send_back_unchosen() marks each one 'sent' and hands it to `payments` (`send-back`, with the secret key),
--    which refunds it and marks it 'paid' (payout_sent()). Marking it first means each is sent once: the person
--    can no longer keep it, and the next hour doesn't send it again. A refund that fails leaves it 'sent' for the
--    owner (docs/wiki/Money-Exceptions.md), never retried on its own, since half of it may already have gone.
-- 3. The app's own "Send it back to your card" claims its return the same way first (payout_claim()), so a double
--    tap, or the hour's run at the same moment, can't refund it twice.
-- Proven by supabase/tests/unchosen_money_rls.sql, with balance_rls.sql updated for rewards.

-- ── 1. Rewards straight into Kept balance ─────────────────────────────────────────────────────────

-- Each due reward of the challenge that real money backs becomes its finisher's balance, once.
create function public.rewards_to_balance(challenge uuid) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  o public.payouts;
begin
  for o in
    select * from public.payouts p
    where p.challenge_id = challenge and p.kind = 'reward' and p.status = 'due' and public.payout_backed(p)
    for update
  loop
    insert into public.balance_entries (user_id, amount_cents, source, payout_id, key)
      values (o.user_id, o.amount_cents, 'payout', o.id, 'payout:' || o.id)
      on conflict (key) do nothing;
    update public.payouts set destination = 'balance', status = 'paid' where id = o.id;
  end loop;
end $$;

-- 0060's trigger function, with rewards paid in as soon as they're recorded.
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
    perform public.rewards_to_balance(challenge);
    return null;
  end
  $$;

select public.rewards_to_balance(c.id)
from public.challenges c
where exists (select 1 from public.payouts o where o.challenge_id = c.id and o.kind = 'reward' and o.status = 'due');

-- ── 2. Returns nobody chose for go back to their card ─────────────────────────────────────────────

-- Due, backed returns that waited 14 days for a choice.
create function public.unchosen_returns() returns setof public.payouts
  language sql stable security definer set search_path = ''
  as $$
    select o.* from public.payouts o
    where o.status = 'due' and o.kind = 'return' and o.challenge_id is not null
      and o.created_at < now() - interval '14 days' and public.payout_backed(o)
  $$;

-- Marks each 'sent' and asks `payments` to send it back; answers how many it sent.
create function public.send_back_unchosen() returns int
  language sql security definer set search_path = ''
  as $$
    with sent as (
      update public.payouts o set status = 'sent'
      where o.id in (select u.id from public.unchosen_returns() u) and o.status = 'due'
      returning o.id
    )
    select count(net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/payments',
      body := jsonb_build_object('action', 'send-back', 'payout', sent.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')
      )
    ))::int
    from sent
  $$;

select cron.schedule('send-back-unchosen', '23 * * * *', $$ select public.send_back_unchosen() $$);

-- ── 3. The app's send-back claims its return first ────────────────────────────────────────────────

-- The person's own due, backed return, now 'sent'; no row if it isn't theirs, isn't a return, or already moved.
create function public.payout_claim(payout uuid, person uuid) returns setof public.payouts
  language sql security definer set search_path = ''
  as $$
    update public.payouts o set status = 'sent'
    where o.id = payout and o.user_id = person and o.status = 'due' and o.kind = 'return' and o.challenge_id is not null
      and public.payout_backed(o)
    returning o.*
  $$;

-- 0063's, finishing a claimed (sent) return as well as a due one.
create or replace function public.payout_sent(payout uuid, sent_to text) returns void
  language sql security definer set search_path = ''
  as $$ update public.payouts set destination = sent_to, status = 'paid' where id = payout and status in ('due', 'sent') $$;

revoke execute on function public.rewards_to_balance(uuid), public.unchosen_returns(), public.send_back_unchosen(),
  public.payout_claim(uuid, uuid), public.payout_sent(uuid, text), public.donations_after_change()
  from public, anon, authenticated;
grant execute on function public.payout_claim(uuid, uuid), public.payout_sent(uuid, text) to service_role;
