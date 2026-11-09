// Unit tests for payment-methods.ts: Settings → Payment methods, demo cards and Stripe's real ones (T92).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { handleNextAction, initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { FunctionsHttpError } from '@supabase/supabase-js';

import {
  addDemoMethod,
  CardDeclined,
  cardLabel,
  defaultKind,
  EMPTY_METHODS,
  ensureCard,
  forgetPaymentMethods,
  loadPaymentMethods,
  newCardId,
  payByCard,
  PaymentsError,
  removeMethod,
  savePaymentMethods,
  setDefaultMethod,
  stripeEnabled,
  withStripeCards,
  type SavedCard,
} from './payment-methods';
import { supabase } from './supabase';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('./supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('@stripe/stripe-react-native', () => ({
  handleNextAction: jest.fn(),
  initPaymentSheet: jest.fn(),
  presentPaymentSheet: jest.fn(),
  PaymentSheetError: { Canceled: 'Canceled' },
}));

beforeEach(() => AsyncStorage.clear());

describe('pretend payment methods', () => {
  it('adds a demo card with a pretend label, and the first one added becomes the default', () => {
    const state = addDemoMethod(EMPTY_METHODS, 'card', 'm1');
    expect(state).toEqual({ methods: [{ id: 'm1', kind: 'card', label: 'Visa •••• 4242' }], defaultId: 'm1' });
  });

  it('adds a demo Solana wallet without changing an existing default', () => {
    const state = addDemoMethod(addDemoMethod(EMPTY_METHODS, 'card', 'm1'), 'solana_usdc', 'm2');
    expect(state.methods[1]).toEqual({ id: 'm2', kind: 'solana_usdc', label: 'Solana wallet 7xKX…9fA2' });
    expect(state.defaultId).toBe('m1');
  });

  it('names any Solana Pay wallet once Solana stakes are collected (T169)', () => {
    expect(addDemoMethod(EMPTY_METHODS, 'solana_usdc', 'm1', true).methods[0].label).toBe('Phantom, Solflare or any Solana Pay wallet');
  });

  it('gives a second card or wallet a different pretend label', () => {
    const cards = addDemoMethod(addDemoMethod(EMPTY_METHODS, 'card', 'm1'), 'card', 'm2');
    expect(cards.methods.map((m) => m.label)).toEqual(['Visa •••• 4242', 'Visa •••• 1881']);
  });

  it('makes any method the default', () => {
    const state = addDemoMethod(addDemoMethod(EMPTY_METHODS, 'card', 'm1'), 'solana_usdc', 'm2');
    expect(setDefaultMethod(state, 'm2').defaultId).toBe('m2');
    expect(defaultKind(setDefaultMethod(state, 'm2'))).toBe('solana_usdc');
  });

  it('picks another default when the default is removed, and none when the last one goes', () => {
    const state = addDemoMethod(addDemoMethod(EMPTY_METHODS, 'card', 'm1'), 'solana_usdc', 'm2');
    const afterRemove = removeMethod(state, 'm1');
    expect(afterRemove).toEqual({ methods: [state.methods[1]], defaultId: 'm2' });
    expect(removeMethod(afterRemove, 'm2')).toEqual(EMPTY_METHODS);
    expect(defaultKind(EMPTY_METHODS)).toBeNull();
  });

  it('keeps each user’s methods separately on the device, and survives a reload', async () => {
    const mine = addDemoMethod(EMPTY_METHODS, 'card', 'm1');
    await savePaymentMethods('user-a', mine);
    expect(await loadPaymentMethods('user-a')).toEqual(mine);
    expect(await loadPaymentMethods('user-b')).toEqual(EMPTY_METHODS);
  });

  it('forgets only that user’s methods when their account is deleted', async () => {
    await savePaymentMethods('user-a', addDemoMethod(EMPTY_METHODS, 'card', 'm1'));
    await savePaymentMethods('user-b', addDemoMethod(EMPTY_METHODS, 'solana_usdc', 'm2'));
    await forgetPaymentMethods('user-a');
    expect(await loadPaymentMethods('user-a')).toEqual(EMPTY_METHODS);
    expect((await loadPaymentMethods('user-b')).methods).toHaveLength(1);
  });

  it('starts empty when storage has nothing usable', async () => {
    await AsyncStorage.setItem('kept.paymentMethods.user-a', 'not json');
    expect(await loadPaymentMethods('user-a')).toEqual(EMPTY_METHODS);
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await loadPaymentMethods('user-a')).toEqual(EMPTY_METHODS);
  });
});

describe('real cards through Stripe (T92)', () => {
  const visa: SavedCard = { id: 'pm_visa', brand: 'visa', last4: '4242', expMonth: 4, expYear: 2029 };
  const amex: SavedCard = { id: 'pm_amex', brand: 'amex', last4: '0005', expMonth: 12, expYear: 2031 };
  const wallet = { id: 'w1', kind: 'solana_usdc' as const, label: 'Phantom, Solflare or any Solana Pay wallet' };

  it('is on only in builds with Stripe’s publishable key', () => {
    expect(stripeEnabled(undefined)).toBe(false);
    expect(stripeEnabled('')).toBe(false);
    expect(stripeEnabled('pk_test_123')).toBe(true);
  });

  it('labels a card with its brand, last 4 digits and expiry, never more', () => {
    expect(cardLabel(visa)).toBe('Visa •••• 4242 · 04/29');
    expect(cardLabel(amex)).toBe('American Express •••• 0005 · 12/31');
    expect(cardLabel({ ...visa, brand: 'unknown' })).toBe('Card •••• 4242 · 04/29');
  });

  it('puts Stripe’s cards in place of the phone’s, keeping its wallets', () => {
    const phone = { methods: [{ id: 'card-1', kind: 'card' as const, label: 'Visa •••• 4242' }, wallet], defaultId: 'card-1' };
    expect(withStripeCards(phone, [visa, amex], 'pm_amex')).toEqual({
      methods: [
        { id: 'pm_visa', kind: 'card', label: 'Visa •••• 4242 · 04/29' },
        { id: 'pm_amex', kind: 'card', label: 'American Express •••• 0005 · 12/31' },
        wallet,
      ],
      defaultId: 'pm_amex',
    });
  });

  it('keeps a wallet that was the default, and otherwise follows Stripe’s default card', () => {
    expect(withStripeCards({ methods: [wallet], defaultId: 'w1' }, [visa], 'pm_visa').defaultId).toBe('w1');
    expect(withStripeCards({ methods: [wallet], defaultId: null }, [visa], 'pm_visa').defaultId).toBe('pm_visa');
    // The removed card was the default: Stripe's new default takes over.
    expect(withStripeCards({ methods: [], defaultId: 'pm_gone' }, [visa], 'pm_visa').defaultId).toBe('pm_visa');
  });

  it('falls back to the first method, or none, without a Stripe default', () => {
    expect(withStripeCards({ methods: [wallet], defaultId: null }, [], null)).toEqual({ methods: [wallet], defaultId: 'w1' });
    expect(withStripeCards(EMPTY_METHODS, [], null)).toEqual(EMPTY_METHODS);
  });
});

describe('payByCard: a stake or pledge paid up front (T93)', () => {
  const invoke = jest.mocked(supabase.functions.invoke);
  const answer = (...results: object[]) => results.forEach((data) => invoke.mockResolvedValueOnce({ data, error: null } as never));
  beforeEach(() => {
    invoke.mockReset();
    jest.mocked(handleNextAction).mockReset();
  });

  it('pays a challenge’s stake in one call when the card goes through', async () => {
    answer({ status: 'paid' });
    await expect(payByCard({ challenge: 'c1' })).resolves.toBe('paid');
    expect(invoke).toHaveBeenCalledWith('payments', { body: { action: 'pay', challenge: 'c1' } });
  });

  it('runs the bank’s check in the app, then has the server read the payment back', async () => {
    answer({ status: 'action', clientSecret: 'pi_1_secret', charge: 'ch1' }, { status: 'paid' });
    jest.mocked(handleNextAction).mockResolvedValueOnce({ paymentIntent: {} } as never);
    await expect(payByCard({ pledge: { challenge: 'c1', amountCents: 2500, toCharity: true } })).resolves.toBe('paid');
    expect(handleNextAction).toHaveBeenCalledWith('pi_1_secret', 'kept://stripe-redirect');
    expect(invoke).toHaveBeenLastCalledWith('payments', { body: { action: 'confirm', charge: 'ch1' } });
  });

  it('says so when the bank’s check didn’t pass, or the card was declined', async () => {
    answer({ status: 'action', clientSecret: 's', charge: 'ch1' }, { status: 'action', clientSecret: 's', charge: 'ch1' });
    jest.mocked(handleNextAction).mockResolvedValueOnce({ error: { localizedMessage: 'Authentication failed.' } } as never);
    await expect(payByCard({ challenge: 'c1' })).rejects.toThrow(new CardDeclined('Authentication failed.'));
    answer({ status: 'declined', message: 'Your card was declined.' });
    await expect(payByCard({ challenge: 'c1' })).rejects.toThrow(new CardDeclined('Your card was declined.'));
    answer({ status: 'refunded' });
    await expect(payByCard({ challenge: 'c1' })).rejects.toThrow(CardDeclined);
  });

  it('passes on a refused pledge with the database’s reason', async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError({ json: async () => ({ error: 'pledge_refused', message: 'pledge_not_friend', code: 'P0001' }) }),
    } as never);
    const refused = await payByCard({ pledge: { challenge: 'c1', amountCents: 2500 } }).catch((e) => e);
    expect(refused).toBeInstanceOf(PaymentsError);
    expect(refused).toMatchObject({ code: 'pledge_refused', answer: { message: 'pledge_not_friend' } });
  });
});

describe('ensureCard: a card stake adds its card at the spot (owner, 2026-11-03)', () => {
  const invoke = jest.mocked(supabase.functions.invoke);
  const visa: SavedCard = { id: 'pm_visa', brand: 'visa', last4: '4242', expMonth: 4, expYear: 2029 };
  const setup = { customerId: 'cus_1', customerSessionClientSecret: 'cs_1', setupIntentClientSecret: 'seti_1' };
  const answer = (...results: object[]) => results.forEach((data) => invoke.mockResolvedValueOnce({ data, error: null } as never));
  const calls = () => invoke.mock.calls.map(([, options]) => (options as { body: { action: string } }).body.action);
  beforeEach(() => {
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_1';
    invoke.mockReset();
    jest.mocked(initPaymentSheet).mockReset().mockResolvedValue({} as never);
    jest.mocked(presentPaymentSheet).mockReset().mockResolvedValue({} as never);
  });
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  });

  it('opens nothing when a card is already saved', async () => {
    answer({ cards: [visa], defaultId: 'pm_visa' });
    await expect(ensureCard('u1')).resolves.toBe(true);
    expect(presentPaymentSheet).not.toHaveBeenCalled();
    expect(calls()).toEqual(['cards']);
  });

  it('opens Stripe’s card form when there is none, and is ready once the card is saved', async () => {
    answer({ cards: [], defaultId: null }, setup, { cards: [visa], defaultId: 'pm_visa' });
    await expect(ensureCard('u1')).resolves.toBe(true);
    expect(initPaymentSheet).toHaveBeenCalledWith(expect.objectContaining({ merchantDisplayName: 'Kept', ...setup }));
    expect(presentPaymentSheet).toHaveBeenCalledTimes(1);
    expect(calls()).toEqual(['cards', 'setup', 'cards']);
  });

  it('is not ready when the form is closed without saving a card', async () => {
    answer({ cards: [], defaultId: null }, setup, { cards: [], defaultId: null });
    jest.mocked(presentPaymentSheet).mockResolvedValueOnce({ error: { code: 'Canceled' } } as never);
    await expect(ensureCard('u1')).resolves.toBe(false);
  });

  it('says so, in a sentence to show, when the form can’t be opened or fails', async () => {
    answer({ cards: [], defaultId: null }, setup);
    jest.mocked(presentPaymentSheet).mockResolvedValueOnce({ error: { code: 'Failed', localizedMessage: 'Your card number is invalid.' } } as never);
    await expect(ensureCard('u1')).rejects.toThrow(new CardDeclined('Your card number is invalid.'));

    invoke.mockReset();
    invoke.mockResolvedValueOnce({ data: { cards: [], defaultId: null }, error: null } as never);
    invoke.mockResolvedValueOnce({ data: null, error: new Error('offline') } as never);
    await expect(ensureCard('u1')).rejects.toThrow(new CardDeclined('Couldn’t open the card form. Check your connection and try again.'));
  });
});

describe('newCardId', () => {
  const card = (id: string) => ({ id, kind: 'card' as const, label: id });

  it('finds the card the form just saved', () => {
    expect(newCardId({ methods: [card('a')], defaultId: 'a' }, { methods: [card('b'), card('a')], defaultId: 'a' })).toBe('b');
  });

  it('is null when the form was closed without one', () => {
    expect(newCardId({ methods: [card('a')], defaultId: 'a' }, { methods: [card('a')], defaultId: 'a' })).toBeNull();
  });

  it('ignores a wallet added meanwhile', () => {
    const wallet = { id: 'w', kind: 'solana_usdc' as const, label: 'w' };
    expect(newCardId({ methods: [], defaultId: null }, { methods: [wallet], defaultId: 'w' })).toBeNull();
  });
});
