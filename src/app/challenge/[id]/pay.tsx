// Waiting for your wallet (T169, SPEC-payments.md "Solana"): a challenge signed with a Solana stake
// counts only once its payment, the stake plus Kept's fee in the token picked, has arrived in Kept's
// treasury. Signing opens the wallet on the payment (a Solana Pay link); this sheet waits, asking
// solana-pay to look for the transfer every 3 seconds and whenever Kept comes back to the front.
// Open wallet opens it again (and says so if no wallet app answers). A wallet can't send the user back to
// Kept after a Solana Pay approval, so the sheet says to switch back, and finds the payment on its own.
// Cancel removes the unpaid challenge: nothing was taken, so nothing comes back (lib/solana-pay.ts).
// Paid: the sheet closes itself, and the challenge says the payment arrived and Day 1 is tomorrow (one screen,
// owner 2026-10-26). Nothing within 15 minutes: the
// server removes the challenge (nothing was taken), and this says so.
// A crypto pledge (T171) waits here too, with `payment` (start_crypto_pledge()'s id): the same wallet and checks,
// for the pledge and its fee; paid, it closes back to the pledge sheet; unpaid, it just lapses, nothing taken.

import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { ListRow, ListSection } from '@/components/list';
import { feeLines, money, restartDraft, solanaPayLink } from '@/lib/challenges';
import { askToCancelUnpaid } from '@/lib/solana-pay';
import { supabase } from '@/lib/supabase';
import { SCREEN, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { must, useFocusLoad } from '@/lib/use-focus-load';
import { useMyChallenges } from '@/lib/use-my-challenges';

type Status = 'awaiting' | 'expired';
const CHECK_EVERY_MS = 3_000;

export default function Pay() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { id, payment } = useLocalSearchParams<{ id: string; payment?: string }>();
  const { challenges } = useMyChallenges(id);
  const challenge = payment ? undefined : challenges?.[0];
  // A crypto pledge's payment: the pledge (or what a raise adds) and its fee, in the challenger's token.
  const { data: pledgePay } = useFocusLoad(
    async () =>
      payment
        ? (must(await supabase.from('solana_payments').select('stake_cents, fee_cents, token').eq('id', payment).single()) as {
            stake_cents: number;
            fee_cents: number;
            token: string;
          })
        : null,
    payment,
  );
  const [status, setStatus] = useState<Status>('awaiting');
  const [walletError, setWalletError] = useState<string | null>(null);

  /** Opens the wallet on this payment; iOS refuses the link when no wallet app is installed. */
  async function openWallet() {
    setWalletError(null);
    try {
      await Linking.openURL(payment ? solanaPayLink(payment, undefined, 'payment') : solanaPayLink(id));
    } catch {
      setWalletError('No Solana wallet opened. Install Phantom or Solflare from the App Store, then tap Open wallet again.');
    }
  }

  useEffect(() => {
    if (status !== 'awaiting') return;
    let current = true;
    const check = async () => {
      const { data } = await supabase.functions.invoke('solana-pay', { body: payment ? { action: 'check', payment } : { action: 'check', challenge: id } });
      const next = data?.status as Status | 'paid' | undefined;
      if (!current || !next || next === 'awaiting') return;
      if (next === 'paid') {
        // Back to the challenge, which says the payment arrived and when Day 1 is: no second screen to close.
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        AccessibilityInfo.announceForAccessibility(payment ? 'Payment received. Your pledge counts.' : 'Payment received. Day 1 is tomorrow.');
        return router.back();
      }
      setStatus(next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      AccessibilityInfo.announceForAccessibility('No payment arrived.');
    };
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    const foreground = AppState.addEventListener('change', (state) => state === 'active' && check());
    return () => {
      current = false;
      clearInterval(timer);
      foreground.remove();
    };
  }, [id, payment, status]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {status === 'awaiting' && (
        <>
          <Text style={styles.title} accessibilityRole="header">
            Waiting for your wallet
          </Text>
          <Text style={styles.body}>
            Approve the payment in Phantom, Solflare or your Solana Pay wallet, then come back to Kept. Your {payment ? 'pledge' : 'challenge'}{' '}
            counts once the payment arrives, usually within a minute.
          </Text>
          {pledgePay && (
            <ListSection footer={`Paid in ${pledgePay.token} on Solana. Kept pays the network fee. If nothing arrives within 15 minutes, nothing is taken.`}>
              <ListRow label="Pledge" value={money(pledgePay.stake_cents)} first />
              <ListRow label="Kept’s service fee" value={money(pledgePay.fee_cents)} />
              <ListRow label="Total" value={money(pledgePay.stake_cents + pledgePay.fee_cents)} />
            </ListSection>
          )}
          {challenge && (
            <ListSection footer={`Paid with ${challenge.paymentName}. Kept pays the network fee. If nothing arrives within 15 minutes, this challenge is removed and nothing is taken.`}>
              {feeLines('Stake', challenge.stakeDollars * 100).map((line, i) => (
                <ListRow key={line.label} label={line.label} value={line.value} first={i === 0} />
              ))}
            </ListSection>
          )}
          <View style={styles.waiting}>
            <ActivityIndicator color={colors.secondaryText} />
            <Text style={styles.note}>Looking for your payment…</Text>
          </View>
          <ErrorText message={walletError} />
          <Button title="Open wallet" onPress={openWallet} />
          <Text style={styles.note}>
            After you approve in your wallet, switch back to Kept (swipe up from the bottom and choose Kept). Your payment is found on its own.
          </Text>
          <ListSection
            title="New to crypto?"
            footer="Any wallet that supports Solana Pay works; Phantom and Solflare are the two we’ve built for. An exchange app can’t pay directly: withdraw to your wallet’s Solana address first, and pick the Solana network."
          >
            <ListRow label="1. Install Phantom or Solflare (free) and create a wallet" first />
            <ListRow
              label={
                process.env.EXPO_PUBLIC_SOLANA_PAY === 'devnet'
                  ? '2. Switch it to Solana’s devnet. With USDT, Kept tops up your test wallet'
                  : '2. Put USDC, USDT or PYUSD on the Solana network in it'
              }
            />
            <ListRow label="3. Come back here and tap Open wallet" />
          </ListSection>
          {payment ? (
            <Button title="Not now" variant="link" onPress={() => router.back()} />
          ) : (
            <>
              {challenge && (
                <Button
                  title="Pay another way"
                  variant="link"
                  onPress={() =>
                    askToCancelUnpaid(
                      id,
                      () => {
                        router.dismissAll();
                        router.push({ pathname: '/challenge/new/stake', params: restartDraft(challenge) });
                      },
                      setWalletError,
                    )
                  }
                />
              )}
              <Button title="Cancel this challenge" variant="destructiveLink" onPress={() => askToCancelUnpaid(id, () => router.dismissAll(), setWalletError)} />
            </>
          )}
        </>
      )}
      {status === 'expired' && (
        <>
          <Text style={styles.title} accessibilityRole="header">
            No payment arrived
          </Text>
          <Text style={styles.body}>
            {payment ? 'Nothing was taken, and your pledge wasn’t made. You can pledge again.' : 'Nothing was taken, and this challenge was removed. You can start it again.'}
          </Text>
          <Button title="Done" onPress={() => (payment ? router.back() : router.dismissAll())} />
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: SCREEN,
    title: { ...TYPE.title, color: c.text },
    body: { ...TEXT.body, color: c.text },
    waiting: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
    note: { ...TEXT.note, color: c.secondaryText },
  });
