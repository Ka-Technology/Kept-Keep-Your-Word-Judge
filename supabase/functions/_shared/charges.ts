// Card charges up front (T93; SPEC-payments.md "When money moves"), shared by `payments` (the app's calls)
// and `stripe-webhook` (Stripe's word when a payment finishes later, or a bank takes one back, T194). The database prices each charge and
// decides what it pays for (card_charge_succeeded(), migration 0061); this file only talks to Stripe.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2';
import Stripe from 'npm:stripe@23.0.1';

/** Where the bank's check sends the cardholder back (`StripeRedirects` in the app's _layout.tsx). */
export const RETURN_URL = 'kept://stripe-redirect';

/** A `charges` row (0061), as this code reads it. */
export type Charge = {
  id: string;
  user_id: string;
  challenge_id: string | null;
  kind: 'stake' | 'pledge' | 'gift';
  amount_cents: number;
  balance_cents: number;
  total_cents: number;
  refunded_cents: number;
  status: 'pending' | 'succeeded' | 'failed' | 'expired';
  payment_intent_id: string | null;
  /** Set once a bank took it back (T194): 'fraud_warning' or 'dispute'. */
  taken_back: string | null;
  key: string;
};

/** What the app is told: paid, the bank wants a check first, still processing, declined, or refunded whole. */
export type PayResult =
  | { status: 'paid' }
  | { status: 'action'; clientSecret: string; charge: string }
  | { status: 'processing' }
  | { status: 'declined'; message: string }
  | { status: 'refunded' };

/** Sends `cents` of a charge back to its card, once (the key names the amount already refunded), and records it. */
export async function refund(stripe: Stripe, admin: SupabaseClient, row: Charge, cents: number): Promise<void> {
  if (cents <= 0 || !row.payment_intent_id) return;
  await stripe.refunds.create(
    { payment_intent: row.payment_intent_id, amount: cents, metadata: { charge_id: row.id } },
    { idempotencyKey: `${row.key}-refund-${row.refunded_cents}-${cents}` },
  );
  const { error } = await admin.rpc('card_refunded', { charge: row.id, cents });
  if (error) throw error;
}

async function fresh(admin: SupabaseClient, id: string): Promise<Charge> {
  const { data, error } = await admin.from('charges').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Charge;
}

/**
 * Acts on where a PaymentIntent stands. Succeeded: the database pays for what it was for, or, when nothing's
 * left to pay for (the unpaid challenge expired, the pledge broke a rule meanwhile), the whole charge goes back.
 * The bank wants a check: the app runs it with the client secret. Failed: the database lets the charge go.
 */
export async function settle(stripe: Stripe, admin: SupabaseClient, row: Charge, intent: Stripe.PaymentIntent): Promise<PayResult> {
  if (intent.status === 'succeeded') {
    const { data, error } = await admin.rpc('card_charge_succeeded', { charge: row.id, intent: intent.id });
    if (error) throw error;
    const now = await fresh(admin, row.id);
    if (data === 'refund') await refund(stripe, admin, now, now.total_cents - now.refunded_cents);
    else if (now.refunded_cents < now.total_cents || data === 'paid') return { status: 'paid' };
    return { status: 'refunded' };
  }
  if (intent.status === 'requires_action' || intent.status === 'processing') {
    const { error } = await admin.from('charges').update({ payment_intent_id: intent.id }).eq('id', row.id);
    if (error) throw error;
    return intent.status === 'processing' || !intent.client_secret
      ? { status: 'processing' }
      : { status: 'action', clientSecret: intent.client_secret, charge: row.id };
  }
  const message = intent.last_payment_error?.message ?? 'Your card was declined.';
  const { error } = await admin.rpc('card_charge_failed', { charge: row.id, reason: message });
  if (error) throw error;
  return { status: 'declined', message };
}

/**
 * Sends `cents` of what a person paid back the way it came, across their paid charges for one thing (a stake,
 * or a pledge and its raises), oldest first: the card part as a refund, the part a balance paid to the balance.
 */
export async function giveBack(stripe: Stripe, admin: SupabaseClient, rows: Charge[], cents: number, key: string) {
  let left = cents;
  for (const row of rows) {
    const card = Math.min(row.amount_cents - row.balance_cents, row.total_cents - row.refunded_cents, left);
    if (card > 0) {
      await refund(stripe, admin, row, card);
      left -= card;
    }
    const back = Math.min(row.balance_cents, left);
    if (back > 0) {
      const { error } = await admin.rpc('balance_credit', {
        person: row.user_id,
        cents: back,
        entry_key: `${key}:${row.id}`,
        entry_source: 'withdraw',
        from_charge: row.id,
        from_payout: null,
      });
      if (error) throw error;
      left -= back;
    }
  }
}

/** A person's paid charges for one challenge's stake or pledge, oldest first; never one a bank took back (T194). */
export async function paidFor(admin: SupabaseClient, userId: string, challenge: string, kind: 'stake' | 'pledge') {
  const { data, error } = await admin
    .from('charges')
    .select('*')
    .eq('user_id', userId)
    .eq('challenge_id', challenge)
    .eq('kind', kind)
    .eq('status', 'succeeded')
    .is('error', null)
    .is('taken_back', null)
    .order('created_at');
  if (error) throw error;
  return data as Charge[];
}
