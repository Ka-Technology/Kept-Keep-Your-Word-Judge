// Start a challenge, step 3 of 5 (as in the A3 mockup since T111, full-set/sheet-new.jpg "stake"):
// "Your stake" (pretend money, whole dollars, within the limits that apply to this user, the first
// challenge's under the amount), then once it's valid the stake, Kept's service fee on top and the
// total (T63), and the way to pay, Card or Crypto (a dollar stablecoin on Solana: USDC, USDT or PYUSD, picked
// under it once wallets are real), preselected from the default payment
// method (Settings → Payment methods). Nothing is charged in the demo.

import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { Segmented } from '@/components/segmented';
import { LoadingScreen, StepScreen } from '@/components/step-screen';
import { DollarInput } from '@/components/dollar-input';
import { ListRow, ListSection } from '@/components/list';
import { Tile } from '@/components/tile';
import {
  feeLines,
  defaultSolanaToken,
  money,
  parseStakeDollars,
  PAYMENT_METHODS,
  SOLANA_TOKENS,
  solanaPayEnabled,
  stakeContext,
  stakeError,
  STAKE_LIMITS,
  type ChallengeDraft,
} from '@/lib/challenges';
import { useAuth } from '@/lib/auth';
import { defaultKind, loadPaymentMethods, stripeEnabled } from '@/lib/payment-methods';
import { supabase } from '@/lib/supabase';
import { ICON, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';
import { must, useFocusLoad } from '@/lib/use-focus-load';

export default function StakeStep() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const draft = useLocalSearchParams<ChallengeDraft>();
  const [text, setText] = useState('');
  const [payment, setPayment] = useState<string>(PAYMENT_METHODS[0].code);
  const [token, setToken] = useState<string>(defaultSolanaToken());
  // Real Solana stakes (T169): the wallet pays the stake and fee in the token picked here.
  const wallet = payment === 'solana_usdc' && solanaPayEnabled();
  const [attempted, setAttempted] = useState(false);
  const { session } = useAuth();
  const userId = session?.user.id;

  // Preselect the default payment method's way to pay, if the user has one.
  useEffect(() => {
    if (!userId) return;
    let current = true;
    loadPaymentMethods(userId).then((methods) => {
      const kind = defaultKind(methods);
      if (current && kind) setPayment(kind);
    });
    return () => {
      current = false;
    };
  }, [userId]);

  // The limits depend on the user's own other challenges (not friends'): is this the first, and
  // what's still staked.
  const { data: context, failed, reload } = useFocusLoad(
    async () => stakeContext(must(await supabase.from('challenges').select('stake_cents, outcome').eq('user_id', userId!)) ?? []),
    userId,
  );

  // Kept balance (T189) and credits (T164) left: they pay first where a card is charged for real.
  const { data: left } = useFocusLoad(async () => {
    if (!stripeEnabled()) return { credits: 0, balance: 0 };
    const [credits, balance] = await Promise.all([supabase.rpc('my_credits'), supabase.rpc('my_balance')]);
    return { credits: must(credits) as number, balance: must(balance) as number };
  }, userId);

  if (!context) return <LoadingScreen failed={failed} onRetry={reload} />;

  const stake = parseStakeDollars(text);
  const problem = stakeError(stake, context);
  const limit = context.isFirst
    ? `At least $${STAKE_LIMITS.minDollars}, up to $${STAKE_LIMITS.firstChallengeMaxDollars} on your first challenge.`
    : `At least $${STAKE_LIMITS.minDollars}. Challenges that haven’t ended can total up to $${STAKE_LIMITS.outstandingMaxDollars}.`;

  function next() {
    setAttempted(true);
    if (problem) return AccessibilityInfo.announceForAccessibility(problem);
    router.push({ pathname: '/challenge/new/charity', params: { ...draft, stake: String(stake), payment, ...(wallet && { token }) } });
  }

  return (
    <StepScreen step={3} question="Your stake" error={attempted || text !== '' ? problem : null} onPress={next}>
      <DollarInput
        value={text}
        onChangeText={setText}
        placeholder="10"
        accessibilityLabel="Stake in dollars"
        caption={context.isFirst ? `Up to $${STAKE_LIMITS.firstChallengeMaxDollars} on your first challenge` : `At least $${STAKE_LIMITS.minDollars}`}
        big
      />
      {stake !== null && !problem && (
        <ListSection footer="Kept’s service fee is on top of your stake and non-refundable once you sign; only the stake comes back or goes to the charity.">
          {feeLines('Stake', stake * 100, payment === 'solana_usdc' ? 0 : (left?.credits ?? 0), payment === 'balance' ? (left?.balance ?? 0) : 0).map((line, i) => (
            <ListRow key={line.label} label={line.label} value={line.value} first={i === 0} />
          ))}
        </ListSection>
      )}

      <View style={styles.field}>
        <Tile style={styles.payCard}>
          <Segmented
            label="Way to pay"
            options={[
              ...PAYMENT_METHODS.map((m) => ({ value: m.code as string, label: m.code === 'card' ? 'Card' : 'Crypto' })),
              // Kept balance (decision 150), where cards are real and there's some to spend.
              ...((left?.balance ?? 0) > 0 ? [{ value: 'balance', label: 'Kept balance' }] : []),
            ]}
            value={payment}
            onChange={setPayment}
          />
        </Tile>
        {wallet && (
          <Tile style={styles.payCard}>
            <Segmented label="Token" options={SOLANA_TOKENS.map((t) => ({ value: t, label: t }))} value={token} onChange={setToken} />
          </Tile>
        )}
        <Text style={styles.explanation}>
          {payment === 'card'
            ? 'A debit or credit card, charged through Kept’s payment processor.'
            : payment === 'balance'
              ? `Your Kept balance (${money(left?.balance ?? 0)}) pays first, with no service fee on the part it covers; your card pays any rest.`
              : wallet
              ? `${token}, a dollar stablecoin on Solana, from a wallet like Phantom or Solflare. Your stake and the fee are paid from your wallet when you sign.`
              : 'Crypto: USDC, a dollar stablecoin on Solana, from your own wallet.'}{' '}
          {limit} Finish and it comes back to you; if you don’t, it goes to the charity you pick next.
        </Text>
      </View>
      {wallet && (
        <View style={styles.devnet}>
          <SymbolView name={{ ios: 'banknote', android: 'payments' }} size={ICON.inline} tintColor={colors.secondaryText} />
          {/* ponytail: devnet only until S5 (T172) names mainnet here. */}
          <Text style={styles.devnetText}>Test tokens on Solana’s devnet. With USDT, Kept tops up your test wallet.</Text>
        </View>
      )}
    </StepScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    field: { gap: SPACE.sm },
    payCard: { padding: SPACE.sm },
    explanation: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
    devnet: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginHorizontal: SPACE.xs },
    devnetText: { ...TEXT.note, color: c.secondaryText },
  });
