// Stripe's webhook (T93; SPEC-payments.md flow 4): the final word when a payment finishes after the app
// stopped waiting (a bank check completed later, or the app closed). It checks Stripe's signature with
// STRIPE_WEBHOOK_SECRET, then fetches the event back from Stripe by its id (SPEC.md rule 5), so nothing in
// the request body is trusted. Events:
//   payment_intent.succeeded         the charge is paid: the challenge counts, or the pledge is saved (or the
//                                    whole charge goes back when there's nothing left to pay for)
//   payment_intent.payment_failed    the charge lets go, and an unpaid challenge is removed
//   charge.dispute.created / closed  the dispute's status goes on the charge; Stripe emails the owner, who
//                                    answers in the Dashboard with the challenge's check-ins as evidence
//   radar.early_fraud_warning.created
//                                    the warned charge is refunded whole at once, before it can become a dispute
// A warning or a new dispute on a pledge is taken back once (pledge_taken_back(), migration 0068, T194): on a
// running challenge the pledge is withdrawn and its other charges go back the way they came; on a reward the
// finisher's Kept balance pays it back; a return still due stops.
// Secrets: STRIPE_SECRET_KEY (test keys only until T176, like `payments`) and STRIPE_WEBHOOK_SECRET. Without
// either it answers 503, so Stripe retries until they're set. Endpoint: <project>/functions/v1/stripe-webhook.

import { withSupabase } from 'npm:@supabase/server@^1';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2';
import Stripe from 'npm:stripe@23.0.1';

import { giveBack, paidFor, refund, settle, type Charge } from '../_shared/charges.ts';

/** A pledge's card charge a bank took back (a fraud warning or a dispute): what its money became pays for it, once. */
async function takeBack(stripe: Stripe, admin: SupabaseClient, row: Charge, why: 'fraud_warning' | 'dispute') {
  const { data: what, error } = await admin.rpc('pledge_taken_back', { charge: row.id, why });
  if (error) throw error;
  // Stripe's retry of a warning whose refund failed finishes that one refund (it can't pass the charge's total).
  // ponytail: a failed give-back of a withdrawn pledge's other charges isn't retried; the owner sees the log.
  if (what === 'not_a_pledge' || (what === 'already' && row.taken_back !== 'fraud_warning')) return what;
  // A warning: the whole charge goes back now, fee too, so it never turns into a $15 dispute.
  if (why === 'fraud_warning') await refund(stripe, admin, row, row.total_cents - row.refunded_cents);
  if (what === 'withdrawn' && row.challenge_id) {
    const others = await paidFor(admin, row.user_id, row.challenge_id, 'pledge');
    await giveBack(stripe, admin, others, others.reduce((sum, r) => sum + r.amount_cents, 0), `takeback:${row.id}`);
  }
  console.error('stripe-webhook: pledge taken back', why, row.id, what);
  return what;
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    const key = Deno.env.get('STRIPE_SECRET_KEY');
    const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    if (!key?.startsWith('sk_test_') || !secret) return Response.json({ error: 'stripe_not_configured' }, { status: 503 });
    const stripe = new Stripe(key);
    const admin = ctx.supabaseAdmin;

    let id: string;
    try {
      const signed = await stripe.webhooks.constructEventAsync(
        await req.text(),
        req.headers.get('stripe-signature') ?? '',
        secret,
        undefined,
        Stripe.createSubtleCryptoProvider(),
      );
      id = signed.id;
    } catch {
      return Response.json({ error: 'bad_signature' }, { status: 400 });
    }
    const event = await stripe.events.retrieve(id);

    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object;
      const chargeId = intent.metadata?.charge_id;
      if (!chargeId) return Response.json({ ignored: true });
      const { data: row, error } = await admin.from('charges').select('*').eq('id', chargeId).maybeSingle();
      if (error) throw error;
      if (!row) return Response.json({ ignored: true });
      // Read the intent fresh: the event is a snapshot, and the app may have moved it on since.
      const result = await settle(stripe, admin, row as Charge, await stripe.paymentIntents.retrieve(intent.id));
      return Response.json(result);
    }

    if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
      const dispute = event.data.object;
      const intent = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
      if (intent) {
        const { data: row, error } = await admin
          .from('charges')
          .update({ dispute_status: dispute.status, updated_at: new Date().toISOString() })
          .eq('payment_intent_id', intent)
          .select('*')
          .maybeSingle();
        if (error) throw error;
        if (row && event.type === 'charge.dispute.created') await takeBack(stripe, admin, row as Charge, 'dispute');
      }
      console.error('stripe-webhook: dispute', dispute.status, intent);
      return Response.json({ recorded: true });
    }

    if (event.type === 'radar.early_fraud_warning.created') {
      const warning = event.data.object;
      let intent = typeof warning.payment_intent === 'string' ? warning.payment_intent : warning.payment_intent?.id;
      if (!intent) {
        const charge = await stripe.charges.retrieve(typeof warning.charge === 'string' ? warning.charge : warning.charge.id);
        intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      }
      const { data: row, error } = intent ? await admin.from('charges').select('*').eq('payment_intent_id', intent).maybeSingle() : { data: null, error: null };
      if (error) throw error;
      if (!row) return Response.json({ ignored: true });
      // A stake's warning is the owner's to handle (docs/wiki/Money-Exceptions.md): Stripe emails them.
      return Response.json({ takenBack: await takeBack(stripe, admin, row as Charge, 'fraud_warning') });
    }

    return Response.json({ ignored: true });
  }),
};
