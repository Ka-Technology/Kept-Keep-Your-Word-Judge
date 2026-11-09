// Real cards through Stripe (T92; SPEC-payments.md "Saving a card"). The app calls it with the user's token:
//   { action: 'setup' }                    finds or creates the user's Stripe Customer (with their email, for
//                                          Stripe's receipts, T199), then answers what
//                                          Stripe's Payment Sheet needs to save a card for later charges:
//                                          { customerId, customerSessionClientSecret, setupIntentClientSecret }.
//                                          The sheet takes the card, so no card number ever reaches Kept.
//   { action: 'cards' }                    the saved cards, { cards: [{ id, brand, last4, expMonth, expYear }],
//                                          defaultId }. The default lives on the Customer in Stripe; with
//                                          none set, the first card saved becomes it (T93 charges the default).
//   { action: 'default', paymentMethod }   makes one of the user's own cards the default.
//   { action: 'remove', paymentMethod }    removes one of the user's own cards.
//   { action: 'delete-customer' }          before the account is deleted: deletes the Customer, which
//                                          removes its cards. A failure never blocks the deletion.
// Charges up front (T93, decision 142; SPEC-payments.md "When money moves"), each answering a PayResult
// (_shared/charges.ts): { status: 'paid' | 'processing' | 'refunded' }, { status: 'action', clientSecret,
// charge } for the bank's check, or { status: 'declined', message }:
//   { action: 'pay', challenge }           charges a card challenge's stake and fee (its `charges` row,
//                                          priced by the database) on the default card, on-session, asking
//                                          the bank for 3-D Secure (T197).
//   { action: 'pay', pledge: { challenge, amountCents, donate, toCharity, useBalance } }
//                                          checks the pledge or raise as the pledger (check_pledge()), prices
//                                          it (pledge_charge()), charges it, and saves it once paid.
//   { action: 'pay', gift: { challenge, amountCents } }
//                                          an extra gift once the challenge ended (amountCents is the new total):
//                                          checked as the giver (check_gift()), charged for what it adds with no
//                                          fee (gift_charge(), migration 0079), and saved once paid.
//   { action: 'confirm', charge }          after the bank's check in the app: reads the payment back from Stripe.
//   { action: 'cancel', challenge }        an unpaid card challenge: cancels its payment and removes it.
//   { action: 'withdraw', challenge }      a pledge withdrawn by the end of Day 1: deletes it (as the pledger,
//                                          so the database's Day 1 rule applies) and refunds its amount, never the fee.
// Each `pay` may carry `authorization`, the card authorization the app showed (T179); it's stored on the charge
// with when it was accepted, once, before charging.
// Kept balance (T189, decision 145): a charge the balance covers whole is paid without Stripe; a part a
// balance paid always goes back to the balance, never the card.
//   { action: 'balance-to-card' }          Kept balance that came from returns kept in Kept goes back to the cards
//                                          those were paid with (migration 0080), up to the balance there is now; a
//                                          reward's never does. Each part leaves the balance first, then is refunded,
//                                          and comes back to the balance if the refund fails. Answers { status, cents }.
//   { action: 'send-back', payout }        money coming back (a return, not a reward) goes back to its card:
//                                          each charge's card part refunded, any balance part to the balance.
//                                          The return is claimed first (payout_claim(), migration 0067), so it's
//                                          sent once. pg_cron calls it too, with the secret key, for a return
//                                          nobody chose for in 14 days (send_back_unchosen() claimed it, T198);
//                                          that's the only thing the secret key can do here.
// Secret: STRIPE_SECRET_KEY, a test key (`sk_test_…`) until the live-mode switch (T176). Without one, or
// with a live key, it answers `stripe_not_configured` (503) and changes nothing.

import { withSupabase } from 'npm:@supabase/server@^1';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2';
import Stripe from 'npm:stripe@23.0.1';

import { giveBack, paidFor, refund, RETURN_URL, settle, type Charge, type PayResult } from '../_shared/charges.ts';

/**
 * The user's Stripe Customer id, created on first use when `create` is set; null if there's none. It carries the
 * account's email, so Stripe emails its own receipt for each charge and refund (T199, decision 160); given an
 * email, an existing Customer takes it too, so receipts follow a changed email (T207, decision 168).
 * ponytail: one Stripe update per card setup and charge; keep the last email set in stripe_customers if that latency matters.
 */
async function customerFor(stripe: Stripe, admin: SupabaseClient, userId: string, create: boolean, email?: string): Promise<string | null> {
  const stored = async () => {
    const { data, error } = await admin.from('stripe_customers').select('customer_id').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return (data?.customer_id as string | undefined) ?? null;
  };
  const existing = await stored();
  if (existing && email) await stripe.customers.update(existing, { email });
  if (existing || !create) return existing;
  const customer = await stripe.customers.create({ ...(email ? { email } : {}), metadata: { user_id: userId } });
  const { error } = await admin.from('stripe_customers').upsert({ user_id: userId, customer_id: customer.id }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (error) throw error;
  // Two setups at once (a double tap) each create one: the first stored wins, and the other is deleted.
  const winner = await stored();
  if (winner !== customer.id) await stripe.customers.del(customer.id);
  return winner;
}

/** Whether a payment method id belongs to this Customer, so nobody can touch another user's card. */
async function owns(stripe: Stripe, customerId: string, paymentMethod: string): Promise<boolean> {
  if (!paymentMethod.startsWith('pm_')) return false;
  const pm = await stripe.paymentMethods.retrieve(paymentMethod);
  return pm.customer === customerId;
}

/** The Customer's default card, or its first one; null with none saved. */
async function defaultCard(stripe: Stripe, customerId: string): Promise<string | null> {
  const customer = await stripe.customers.retrieve(customerId);
  const set = !customer.deleted && customer.invoice_settings.default_payment_method;
  if (set) return typeof set === 'string' ? set : set.id;
  const { data } = await stripe.customers.listPaymentMethods(customerId, { type: 'card', limit: 1 });
  return data[0]?.id ?? null;
}

/** Charges a pending charge on the default card, on-session, once (its key); a declined card lets the charge go. */
async function pay(stripe: Stripe, admin: SupabaseClient, row: Charge, customerId: string | null): Promise<PayResult> {
  if (row.total_cents === 0) {
    // Kept balance paid all of it (T189): nothing for Stripe.
    const { data, error } = await admin.rpc('card_charge_succeeded', { charge: row.id, intent: null });
    if (error) throw error;
    return data === 'refund' ? { status: 'refunded' } : { status: 'paid' };
  }
  if (row.payment_intent_id) return settle(stripe, admin, row, await stripe.paymentIntents.retrieve(row.payment_intent_id));
  const card = customerId && (await defaultCard(stripe, customerId));
  if (!card) {
    const message = 'Add a card in Settings → Payments first.';
    await admin.rpc('card_charge_failed', { charge: row.id, reason: message });
    return { status: 'declined', message };
  }
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: row.total_cents,
        currency: 'usd',
        customer: customerId,
        payment_method: card,
        confirm: true,
        allowed_payment_method_types: ['card'],
        // 3-D Secure on every card that has it (T197, decision 157): the bank's check runs in the app, and a
        // fraud dispute's loss usually moves to the bank. A card without it still goes through, screened by Radar.
        payment_method_options: { card: { request_three_d_secure: 'any' } },
        return_url: RETURN_URL,
        metadata: { charge_id: row.id, user_id: row.user_id, kind: row.kind },
      },
      { idempotencyKey: row.key },
    );
    return settle(stripe, admin, row, intent);
  } catch (e) {
    if (!(e instanceof Stripe.errors.StripeCardError)) throw e;
    await admin.rpc('card_charge_failed', { charge: row.id, reason: e.message });
    return { status: 'declined', message: e.message };
  }
}

/** The caller's own charge by id, or their unpaid challenge's. */
async function ownCharge(admin: SupabaseClient, userId: string, by: { id?: string; challenge?: string }): Promise<Charge | null> {
  let query = admin.from('charges').select('*').eq('user_id', userId);
  query = by.id ? query.eq('id', by.id) : query.eq('challenge_id', by.challenge!).eq('kind', 'stake').eq('status', 'pending');
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as Charge | null;
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

/** Stores the card authorization the app showed on the charge it authorizes, once (T179). */
async function authorize(admin: SupabaseClient, row: Charge, authorization: unknown) {
  if (typeof authorization !== 'string' || !authorization) return;
  const { error } = await admin
    .from('charges')
    .update({ card_authorization: authorization.slice(0, 1000), authorized_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('authorized_at', null);
  if (error) throw error;
}

export default {
  fetch: withSupabase({ auth: ['user', 'secret'] }, async (req, ctx) => {
    const key = Deno.env.get('STRIPE_SECRET_KEY');
    // Test keys only until the live-mode switch (T176): a live key set here by mistake must never charge anyone.
    if (!key?.startsWith('sk_test_')) return Response.json({ error: 'stripe_not_configured' }, { status: 503 });
    const stripe = new Stripe(key);
    const body = await req.json();
    // pg_cron's secret key may only send back a return it already claimed (T198).
    const byCron = ctx.authMode === 'secret';
    if (byCron && body.action !== 'send-back') return Response.json({ error: 'unknown_request' }, { status: 400 });
    const userId = ctx.userClaims?.id as string;
    const admin = ctx.supabaseAdmin;

    try {
      if (body.action === 'setup') {
        const customerId = (await customerFor(stripe, admin, userId, true, ctx.userClaims?.email))!;
        // Cards only (Apple Pay is a card too, once the Merchant ID is set up, T163); Link comes with T163.
        const [session, setupIntent] = await Promise.all([
          stripe.customerSessions.create({ customer: customerId, components: { mobile_payment_element: { enabled: true } } }),
          stripe.setupIntents.create({ customer: customerId, usage: 'off_session', allowed_payment_method_types: ['card'], metadata: { user_id: userId } }),
        ]);
        return Response.json({ customerId, customerSessionClientSecret: session.client_secret, setupIntentClientSecret: setupIntent.client_secret });
      }

      if (body.action === 'cards') {
        const customerId = await customerFor(stripe, admin, userId, false);
        if (!customerId) return Response.json({ cards: [], defaultId: null });
        const [list, customer] = await Promise.all([
          stripe.customers.listPaymentMethods(customerId, { type: 'card', limit: 100 }),
          stripe.customers.retrieve(customerId),
        ]);
        const cards = list.data.map((pm) => ({ id: pm.id, brand: pm.card!.brand, last4: pm.card!.last4, expMonth: pm.card!.exp_month, expYear: pm.card!.exp_year }));
        const set = !customer.deleted && customer.invoice_settings.default_payment_method;
        let defaultId = typeof set === 'string' ? set : set ? set.id : null;
        // Stripe lists the newest first, so the oldest card left becomes the default.
        if (!defaultId && cards.length) {
          defaultId = cards[cards.length - 1].id;
          await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: defaultId } });
        }
        return Response.json({ cards, defaultId });
      }

      if (body.action === 'default' || body.action === 'remove') {
        const customerId = await customerFor(stripe, admin, userId, false);
        const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod : '';
        if (!customerId || !(await owns(stripe, customerId, paymentMethod))) return Response.json({ error: 'not_your_card' }, { status: 403 });
        if (body.action === 'default') await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethod } });
        else await stripe.paymentMethods.detach(paymentMethod);
        return Response.json({ done: true });
      }

      if (body.action === 'pay' && isId(body.challenge)) {
        const row = await ownCharge(admin, userId, { challenge: body.challenge });
        if (!row) return Response.json({ error: 'nothing_to_pay' }, { status: 404 });
        await authorize(admin, row, body.authorization);
        return Response.json(await pay(stripe, admin, row, await customerFor(stripe, admin, userId, false, ctx.userClaims?.email)));
      }

      if (body.action === 'pay' && body.pledge && isId(body.pledge.challenge) && Number.isInteger(body.pledge.amountCents)) {
        const { challenge, amountCents } = body.pledge;
        // Every rule a pledge has, tried as the pledger and undone: nothing is charged for a pledge the database would refuse.
        const { error: refused } = await ctx.supabase.rpc('check_pledge', { challenge, amount: amountCents });
        if (refused) return Response.json({ error: 'pledge_refused', message: refused.message, code: refused.code }, { status: 409 });
        const { data: row, error } = await admin.rpc('pledge_charge', {
          pledger: userId,
          challenge,
          amount: amountCents,
          donate: body.pledge.donate === true,
          to_charity: body.pledge.toCharity === true,
          // Kept balance only when the pledger chose it (decision 150).
          use_balance: body.pledge.useBalance === true,
        });
        if (error) throw error;
        await authorize(admin, row as Charge, body.authorization);
        return Response.json(await pay(stripe, admin, row as Charge, await customerFor(stripe, admin, userId, false, ctx.userClaims?.email)));
      }

      if (body.action === 'pay' && body.gift && isId(body.gift.challenge) && Number.isInteger(body.gift.amountCents)) {
        const { challenge, amountCents } = body.gift;
        const { error: refused } = await ctx.supabase.rpc('check_gift', { challenge, amount: amountCents });
        if (refused) return Response.json({ error: 'gift_refused', message: refused.message, code: refused.code }, { status: 409 });
        const { data: row, error } = await admin.rpc('gift_charge', { giver: userId, challenge, amount: amountCents });
        if (error) throw error;
        await authorize(admin, row as Charge, body.authorization);
        return Response.json(await pay(stripe, admin, row as Charge, await customerFor(stripe, admin, userId, false, ctx.userClaims?.email)));
      }

      if (body.action === 'confirm' && isId(body.charge)) {
        const row = await ownCharge(admin, userId, { id: body.charge });
        if (!row?.payment_intent_id) return Response.json({ error: 'nothing_to_confirm' }, { status: 404 });
        return Response.json(await settle(stripe, admin, row, await stripe.paymentIntents.retrieve(row.payment_intent_id)));
      }

      if (body.action === 'cancel' && isId(body.challenge)) {
        const row = await ownCharge(admin, userId, { challenge: body.challenge });
        if (!row) return Response.json({ error: 'nothing_to_cancel' }, { status: 404 });
        if (row.payment_intent_id) {
          const intent = await stripe.paymentIntents.retrieve(row.payment_intent_id);
          // Paid in the meantime: it counts, so nothing is cancelled.
          if (intent.status === 'succeeded' || intent.status === 'processing') return Response.json(await settle(stripe, admin, row, intent));
          if (intent.status !== 'canceled') await stripe.paymentIntents.cancel(intent.id);
        }
        const { error } = await admin.rpc('card_charge_failed', { charge: row.id, reason: 'cancelled' });
        if (error) throw error;
        return Response.json({ status: 'cancelled' });
      }

      if (body.action === 'withdraw' && isId(body.challenge)) {
        // As the pledger, so the database's own rule (until the end of Day 1) decides.
        const { data: gone, error } = await ctx.supabase.from('pledges').delete().eq('challenge_id', body.challenge).select('id');
        if (error) throw error;
        if (!gone.length) return Response.json({ error: 'pledge_not_withdrawable' }, { status: 409 });
        const paid = await paidFor(admin, userId, body.challenge, 'pledge');
        await giveBack(stripe, admin, paid, paid.reduce((sum, row) => sum + row.amount_cents, 0), `withdraw:${body.challenge}`);
        return Response.json({ status: 'withdrawn' });
      }

      if (body.action === 'balance-to-card') {
        const [{ data: rows, error }, { data: entries, error: entriesError }] = await Promise.all([
          admin.rpc('card_returnable', { person: userId }),
          admin.from('balance_entries').select('amount_cents').eq('user_id', userId).eq('rail', 'card'),
        ]);
        if (error) throw error;
        if (entriesError) throw entriesError;
        const returnable = rows as { payout_id: string; challenge_id: string; source: 'stake' | 'pledge'; cents: number }[];
        let left = Math.min(
          (entries as { amount_cents: number }[]).reduce((sum, e) => sum + e.amount_cents, 0),
          returnable.reduce((sum, r) => sum + r.cents, 0),
        );
        if (left <= 0) return Response.json({ error: 'nothing_to_send' }, { status: 409 });
        let sent = 0;
        for (const r of returnable) {
          if (left <= 0) break;
          // Only what a card paid can go back to one; a part a balance paid stays in the balance.
          const paid = await paidFor(admin, userId, r.challenge_id, r.source);
          const room = paid.reduce((sum, c) => sum + Math.max(Math.min(c.amount_cents - c.balance_cents, c.total_cents - c.refunded_cents), 0), 0);
          const take = Math.min(r.cents, left, room);
          if (take <= 0) continue;
          // Keyed by what the return still held, so a retry of the same step takes it out once.
          const key = `${r.payout_id}:${r.cents}`;
          const { error: outError } = await admin.rpc('balance_cash_out', { person: userId, payout: r.payout_id, cents: take, entry_key: key });
          if (outError) throw outError;
          let rest = take;
          try {
            for (const c of paid) {
              const card = Math.min(c.amount_cents - c.balance_cents, c.total_cents - c.refunded_cents, rest);
              if (card > 0) {
                await refund(stripe, admin, c, card);
                rest -= card;
              }
            }
          } finally {
            // Whatever didn't reach the card goes back to the balance.
            if (rest > 0) {
              const { error: backError } = await admin.rpc('balance_credit', {
                person: userId,
                cents: rest,
                entry_key: `cash_out_undo:${key}`,
                entry_source: 'charge_back',
                from_charge: null,
                from_payout: r.payout_id,
              });
              if (backError) console.error('payments: a cash-out rest not put back', key, rest, backError);
            }
          }
          sent += take - rest;
          left -= take - rest;
        }
        return Response.json({ status: 'sent', cents: sent });
      }

      if (body.action === 'send-back' && isId(body.payout)) {
        // The caller's own due return, claimed ('sent') so a double tap can't send it twice; or one the cron claimed.
        // A reward was someone else's money: it can't go to anyone's card (bank payouts are T190).
        const { data: payout, error } = byCron
          ? await admin.from('payouts').select('*').eq('id', body.payout).eq('status', 'sent').eq('kind', 'return').maybeSingle()
          : await admin.rpc('payout_claim', { payout: body.payout, person: userId }).maybeSingle();
        if (error) throw error;
        if (!payout) return Response.json({ error: 'cant_send_back' }, { status: 409 });
        const { id, user_id, challenge_id, source, amount_cents } = payout as { id: string; user_id: string; challenge_id: string; source: 'stake' | 'pledge'; amount_cents: number };
        // From here a failure leaves it 'sent' for the owner (docs/wiki/Money-Exceptions.md): part may have gone back already.
        const paid = await paidFor(admin, user_id, challenge_id, source);
        if (!paid.length) return Response.json({ error: 'cant_send_back' }, { status: 409 });
        await giveBack(stripe, admin, paid, amount_cents, `payout:${id}`);
        const { error: sentError } = await admin.rpc('payout_sent', { payout: id, sent_to: 'card' });
        if (sentError) throw sentError;
        return Response.json({ status: 'sent' });
      }

      if (body.action === 'delete-customer') {
        const customerId = await customerFor(stripe, admin, userId, false);
        if (!customerId) return Response.json({ deleted: false });
        await stripe.customers.del(customerId);
        await admin.from('stripe_customers').delete().eq('user_id', userId);
        return Response.json({ deleted: true });
      }
    } catch (e) {
      if (!(e instanceof Stripe.errors.StripeError)) throw e;
      console.error('payments: Stripe refused', body.action, e.type, e.code, e.message);
      return Response.json({ error: 'stripe_failed' }, { status: 502 });
    }

    return Response.json({ error: 'unknown_request' }, { status: 400 });
  }),
};
