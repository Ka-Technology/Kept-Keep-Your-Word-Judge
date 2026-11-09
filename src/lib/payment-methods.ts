// Payment methods (Settings → Payment methods, T48, T92). A method is a label and a kind (card or
// Solana), and one is the default, which Start a challenge preselects. The list is kept on the device per
// user (AsyncStorage). Without Stripe's key the cards are pretend: a tap adds a demo one, never asking for
// a number. With it (T92, test mode), cards are real, saved through Stripe's own sheet by the `payments`
// function, and the phone keeps only each card's brand, last 4 digits and expiry, as Stripe lists them.
// Wallets stay on the phone either way (tested in payment-methods.test.ts). With cards real, a card stake
// or pledge is paid up front through payByCard() (T93, decision 142).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { handleNextAction, initPaymentSheet, PaymentSheetError, presentPaymentSheet } from '@stripe/stripe-react-native';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { solanaPayEnabled } from './challenges';
import { supabase } from './supabase';

export type PaymentKind = 'card' | 'solana_usdc';
export type PaymentMethod = { id: string; kind: PaymentKind; label: string };
export type PaymentMethods = { methods: PaymentMethod[]; defaultId: string | null };

export const EMPTY_METHODS: PaymentMethods = { methods: [], defaultId: null };

// Pretend labels: a second card or wallet gets the next one, so they're told apart.
const CARD_ENDINGS = ['4242', '1881', '0005', '3222'];
const WALLETS = ['7xKX…9fA2', '4Nd1…Qm8Z', '9PzB…3kTe', 'Hq2L…Vw7c'];

/**
 * Adds a demo card or wallet. The first method added becomes the default. Once Solana stakes are
 * collected (T169), a wallet isn't stored: whichever wallet opens the Solana Pay link pays.
 */
export function addDemoMethod(state: PaymentMethods, kind: PaymentKind, id: string, walletPay: boolean = solanaPayEnabled()): PaymentMethods {
  const count = state.methods.filter((m) => m.kind === kind).length;
  const label =
    kind === 'card'
      ? `Visa •••• ${CARD_ENDINGS[count % CARD_ENDINGS.length]}`
      : walletPay
        ? 'Phantom, Solflare or any Solana Pay wallet'
        : `Solana wallet ${WALLETS[count % WALLETS.length]}`;
  return { methods: [...state.methods, { id, kind, label }], defaultId: state.defaultId ?? id };
}

/** Removes a method; if it was the default, the first one left becomes the default. */
export function removeMethod(state: PaymentMethods, id: string): PaymentMethods {
  const methods = state.methods.filter((m) => m.id !== id);
  const defaultId = state.defaultId === id ? (methods[0]?.id ?? null) : state.defaultId;
  return { methods, defaultId };
}

export function setDefaultMethod(state: PaymentMethods, id: string): PaymentMethods {
  return { ...state, defaultId: id };
}

/** The default method's kind, which Start a challenge preselects; null with none. */
export function defaultKind(state: PaymentMethods): PaymentKind | null {
  return state.methods.find((m) => m.id === state.defaultId)?.kind ?? null;
}

/**
 * Whether cards are real (T92): only builds with EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY set (`pk_test_…` until
 * the live-mode switch). Without it, cards stay pretend.
 */
export function stripeEnabled(key: string | undefined = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY): boolean {
  return !!key;
}

/** A card saved in Stripe, as the `payments` function lists it. */
export type SavedCard = { id: string; brand: string; last4: string; expMonth: number; expYear: number };

const BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
};

/** "Visa •••• 4242 · 04/29". */
export function cardLabel(card: SavedCard): string {
  return `${BRANDS[card.brand] ?? 'Card'} •••• ${card.last4} · ${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`;
}

/**
 * Stripe's cards in place of the phone's, with its wallets kept. A wallet that was the default stays it;
 * otherwise Stripe's default card is (the one T93 charges), or the first method if there's none.
 */
export function withStripeCards(state: PaymentMethods, cards: SavedCard[], stripeDefault: string | null): PaymentMethods {
  const wallets = state.methods.filter((m) => m.kind !== 'card');
  const methods = [...cards.map((c): PaymentMethod => ({ id: c.id, kind: 'card', label: cardLabel(c) })), ...wallets];
  const walletDefault = wallets.some((m) => m.id === state.defaultId);
  return { methods, defaultId: walletDefault ? state.defaultId : (stripeDefault ?? methods[0]?.id ?? null) };
}

/** What Stripe's Payment Sheet needs to save a card, from the `payments` function. */
export type CardSetup = { customerId: string; customerSessionClientSecret: string; setupIntentClientSecret: string };

/** A refusal from the `payments` function: its error code (`stripe_failed`, …) and the rest of its answer. */
export class PaymentsError extends Error {
  constructor(
    action: string,
    readonly code: string,
    readonly answer: { message?: string; code?: string } | null,
  ) {
    super(`payments ${action}: ${code}`);
  }
}

/** Calls the `payments` function; throws a PaymentsError on any failure, with the function's error code when it gave one. */
export async function payments<T = unknown>(body: { action: string; [key: string]: unknown }): Promise<T> {
  const { data, error } = await supabase.functions.invoke('payments', { body });
  if (error) {
    const answer = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
    throw new PaymentsError(body.action, answer?.error ?? error.message, answer);
  }
  return data as T;
}

/** A card payment that didn't go through, with a sentence to show (Stripe's own for a declined card). */
export class CardDeclined extends Error {}

/** What the `payments` function says a card payment came to (PayResult in supabase/functions/_shared/charges.ts). */
type PayResult =
  | { status: 'paid' | 'processing' | 'refunded' }
  | { status: 'action'; clientSecret: string; charge: string }
  | { status: 'declined'; message: string };

/**
 * Pays by card, up front (T93, decision 142): a card challenge's stake and fee, or a pledge or raise with its
 * fee, on the default card. When the bank wants to check, its screen opens here, then the server reads the
 * payment back from Stripe. Resolves 'paid', or 'processing' when Stripe finishes later (its webhook);
 * throws a CardDeclined for a declined card or a bank check that didn't pass, and a PaymentsError for a
 * refusal (a pledge the database won't take carries its reason in `answer.message`).
 */
export async function payByCard(
  target:
    | { challenge: string }
    | { pledge: { challenge: string; amountCents: number; donate?: boolean; toCharity?: boolean; useBalance?: boolean } }
    | { gift: { challenge: string; amountCents: number } },
  /** The card authorization shown with the button (policies.ts cardAuthorization()), stored on the charge (T179). */
  authorization?: string,
): Promise<'paid' | 'processing'> {
  let result = await payments<PayResult>({ action: 'pay', ...target, authorization });
  if (result.status === 'action') {
    const check = await handleNextAction(result.clientSecret, 'kept://stripe-redirect');
    // Even a cancelled check goes back to the server, which reads where the payment really stands.
    result = await payments<PayResult>({ action: 'confirm', charge: result.charge });
    if (result.status === 'action') throw new CardDeclined(check.error?.localizedMessage ?? 'Your bank didn’t confirm the payment, so nothing was charged.');
  }
  if (result.status === 'paid' || result.status === 'processing') return result.status;
  throw new CardDeclined(result.status === 'declined' ? result.message : 'That couldn’t go through, so your payment was refunded in full.');
}

/**
 * The user's methods: with Stripe on, its saved cards merged into the phone's list, which is saved so
 * Start a challenge preselects from it. Throws if Stripe's cards can't be loaded.
 */
export async function loadWithCards(userId: string): Promise<PaymentMethods> {
  const local = await loadPaymentMethods(userId);
  if (!stripeEnabled()) return local;
  const { cards, defaultId } = await payments<{ cards: SavedCard[]; defaultId: string | null }>({ action: 'cards' });
  const next = withStripeCards(local, cards, defaultId);
  await savePaymentMethods(userId, next);
  return next;
}

/** Opens Stripe's Payment Sheet to save a card for later charges; closing it changes nothing. Throws Stripe's error, or the `payments` function's, when it can't. */
export async function addCardSheet(): Promise<void> {
  const setup = await payments<CardSetup>({ action: 'setup' });
  const init = await initPaymentSheet({ merchantDisplayName: 'Kept', returnURL: 'kept://stripe-redirect', ...setup });
  if (init.error) throw init.error;
  const { error } = await presentPaymentSheet();
  if (error && error.code !== PaymentSheetError.Canceled) throw error;
}

/**
 * Whether a card stake can be charged (owner, 2026-11-03: add the card at the spot, not "Add a card in Settings"
 * after signing). True with a card saved; with none, Stripe's card form opens here, and it's true once a card is
 * saved and false when the form was closed without one. Throws a CardDeclined, with a sentence to show, when the
 * form can't open or the card can't be saved. Real cards only: pretend ones (no Stripe key) never get here.
 */
export async function ensureCard(userId: string): Promise<boolean> {
  const hasCard = (state: PaymentMethods) => state.methods.some((m) => m.kind === 'card');
  try {
    if (hasCard(await loadWithCards(userId))) return true;
    await addCardSheet();
    return hasCard(await loadWithCards(userId));
  } catch (e) {
    throw new CardDeclined((e as { localizedMessage?: string }).localizedMessage ?? 'Couldn’t open the card form. Check your connection and try again.');
  }
}

/** The card in `after` that isn't in `before`, or null: what Stripe's form just saved, if anything. */
export function newCardId(before: PaymentMethods, after: PaymentMethods): string | null {
  return after.methods.find((m) => m.kind === 'card' && !before.methods.some((b) => b.id === m.id))?.id ?? null;
}

/**
 * After a declined card: Stripe's form takes another, which becomes the default, the card every charge uses. True
 * once it's saved, false when the form was closed without one. Throws a CardDeclined, with a sentence to show, when
 * the form can't open or the card can't be saved.
 */
export async function switchCard(userId: string): Promise<boolean> {
  try {
    const before = await loadWithCards(userId);
    await addCardSheet();
    const after = await loadWithCards(userId);
    const id = newCardId(before, after);
    if (!id) return false;
    await payments({ action: 'default', paymentMethod: id });
    await savePaymentMethods(userId, setDefaultMethod(after, id));
    return true;
  } catch (e) {
    throw new CardDeclined((e as { localizedMessage?: string }).localizedMessage ?? 'Couldn’t open the card form. Check your connection and try again.');
  }
}

/** Deletes the user's Stripe Customer, and with it their cards, before the account goes. A failure never blocks the deletion. */
export async function deleteStripeCustomer(): Promise<void> {
  if (stripeEnabled()) await supabase.functions.invoke('payments', { body: { action: 'delete-customer' } }).catch(() => {});
}

const key = (userId: string) => `kept.paymentMethods.${userId}`;

/** The user's saved methods; empty if there are none or storage can't be read. */
export async function loadPaymentMethods(userId: string): Promise<PaymentMethods> {
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(key(userId))) ?? 'null');
    return saved && Array.isArray(saved.methods) ? saved : EMPTY_METHODS;
  } catch {
    return EMPTY_METHODS;
  }
}

/** Saves the user's methods. A failed save just means they're gone after a relaunch (real cards load again from Stripe). */
export async function savePaymentMethods(userId: string, state: PaymentMethods): Promise<void> {
  try {
    await AsyncStorage.setItem(key(userId), JSON.stringify(state));
  } catch {}
}

/** Removes the user's methods from this phone, when their account is deleted (T49). */
export async function forgetPaymentMethods(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(userId));
  } catch {}
}
