// Settings → Payment methods (T48, T92). Without Stripe's key, one tap adds a demo card; with it (T92,
// test mode), Add a card opens Stripe's own Payment Sheet, which saves the card in Stripe, so no screen
// of Kept's ever asks for a card number. A Solana wallet is added with a tap either way. Tapping a method
// makes it the default (which Start a challenge preselects) or removes it; a real card's change goes to
// Stripe first. Until the methods load, it says so rather than "No payment methods yet". As in the A3
// mockup since T129 (full-set/ui-set-2-payments.jpg): "Payments", each method a card with Change, and
// "Stakes and pledges never use in-app purchase."

import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ListScreen } from '@/components/list';
import { LoadingScreen } from '@/components/step-screen';
import { PageTitle } from '@/components/tab-title';
import { Tile } from '@/components/tile';
import { useAuth } from '@/lib/auth';
import { showMenu } from '@/lib/menu';
import {
  addCardSheet,
  addDemoMethod,
  loadWithCards,
  payments,
  removeMethod,
  savePaymentMethods,
  setDefaultMethod,
  stripeEnabled,
  type PaymentKind,
  type PaymentMethod,
  type PaymentMethods,
} from '@/lib/payment-methods';
import { ICON, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';

const TRY_AGAIN = 'Check your connection and try again.';

export default function PaymentMethodsScreen() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const real = stripeEnabled();
  // null until the methods load (Stripe's cards too, when cards are real).
  const [state, setState] = useState<PaymentMethods | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // While a card is being added or changed on Stripe.
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let current = true;
    loadWithCards(userId).then(
      (saved) => current && setState(saved),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [userId, attempt]);

  /** Shows the change at once and saves it on the device. */
  function update(next: PaymentMethods) {
    setState(next);
    if (userId) savePaymentMethods(userId, next);
  }

  if (!state || !userId)
    return (
      <LoadingScreen
        failed={failed}
        onRetry={() => {
          setFailed(false);
          setAttempt((n) => n + 1);
        }}
      />
    );

  const add = (kind: PaymentKind) => update(addDemoMethod(state, kind, `${kind}-${Date.now()}`));

  /** Runs a change on Stripe, then shows the cards as Stripe has them. */
  async function onStripe(change: () => Promise<unknown>, failure: string) {
    setBusy(true);
    try {
      await change();
      setState(await loadWithCards(userId!));
    } catch (e) {
      if (__DEV__) console.warn(e);
      // Stripe's own errors carry a message meant for people (a declined card, say); anything else reads as a connection problem.
      Alert.alert(failure, (e as { localizedMessage?: string }).localizedMessage ?? TRY_AGAIN);
    } finally {
      setBusy(false);
    }
  }

  const addCard = () => onStripe(addCardSheet, 'Couldn’t add your card');

  /** Make it the default, or remove it. */
  const openMethod = (method: PaymentMethod) => {
    const card = real && method.kind === 'card';
    const makeDefault = card
      ? () =>
          onStripe(async () => {
            await payments({ action: 'default', paymentMethod: method.id });
            await savePaymentMethods(userId, setDefaultMethod(state, method.id));
          }, 'Couldn’t change your default')
      : () => update(setDefaultMethod(state, method.id));
    const remove = card ? () => onStripe(() => payments({ action: 'remove', paymentMethod: method.id }), 'Couldn’t remove your card') : () => update(removeMethod(state, method.id));
    showMenu(method.label, [...(method.id === state.defaultId ? [] : [{ label: 'Use as default', run: makeDefault }]), { label: 'Remove', run: remove, destructive: true }]);
  };

  return (
    <ListScreen>
      <PageTitle title="Payments" />

      {state.methods.length === 0 && <Text style={styles.note}>No payment methods yet.</Text>}
      {state.methods.map((m) => (
        <Tile
          key={m.id}
          style={styles.card}
          onPress={() => openMethod(m)}
          accessibilityLabel={[m.kind === 'card' ? 'Card' : 'USDC on Solana', m.label, m.id === state.defaultId ? 'default' : null].filter(Boolean).join(', ')}
          accessibilityHint="Make it the default, or remove it"
        >
          <SymbolView
            name={m.kind === 'card' ? { ios: 'creditcard', android: 'credit_card' } : { ios: 'dollarsign.circle', android: 'paid' }}
            size={ICON.hero}
            tintColor={colors.text}
          />
          <View style={styles.text}>
            <Text style={styles.title}>{m.kind === 'card' ? 'Card' : 'USDC on Solana'}</Text>
            <Text style={styles.detail}>
              {m.label}
              {m.id === state.defaultId ? ' · Default' : ''}
            </Text>
          </View>
          <Text style={styles.change}>Change</Text>
        </Tile>
      ))}

      <View style={styles.actions}>
        <Button title="Add a card" onPress={real ? addCard : () => add('card')} variant="secondary" disabled={busy} />
        <Button title="Connect a Solana wallet" onPress={() => add('solana_usdc')} variant="secondary" />
      </View>
      {real ? (
        <Text style={styles.note}>
          Start a challenge uses your default. Stripe keeps your card, so Kept never sees its number. Crypto is on Solana: the dollar stablecoins
          USDC, USDT and PYUSD, from a wallet like Phantom or Solflare. Stakes and pledges never use in-app purchase.
        </Text>
      ) : (
        <Text style={styles.note}>
          Start a challenge uses your default. Kept will take cards (through Stripe, with Apple Pay) and crypto on Solana: the dollar stablecoins
          USDC, USDT and PYUSD, from a wallet like Phantom or Solflare. Stakes and pledges never use in-app purchase.
        </Text>
      )}
    </ListScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.lg,
      padding: SPACE.lg,
    },
    text: { flex: 1, gap: SPACE.xxs },
    title: { ...TYPE.title, color: c.text },
    detail: { ...TEXT.row, color: c.secondaryText },
    change: { ...TEXT.row, color: c.link, fontWeight: '600' },
    note: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
    actions: { gap: SPACE.md },
  });
