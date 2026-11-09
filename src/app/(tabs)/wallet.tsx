// Wallet (T31; as in the A3 mockup since T106, full-set/sheet-tab.jpg): the wallet icon, "Wallet"
// and "Pretend money in the beta", three key numbers in one row (owner, 2026-09-27: staked now, Kept
// credits, pledged now), then the user's stakes (a K box once one came back, an X box once it went to
// the charity) and what became of each, then Kept credits and pledges. Stakes come from their
// challenges; pledges from my_pledges() (migration 0022), so a pledge shows even after an
// unfriending. Tapping a stake opens its challenge, and tapping a pledge opens its pledge screen.
// Kept credits (T45) are worked out from backer pledges on finished challenges, never stored. Last,
// Donations (T62): the rows the database recorded in the user's name when challenges ended
// (migration 0033), and their total. Every amount is pretend in the demo. With real cards (T189), Kept
// balance and the money coming back that waits for a choice: keep it in Kept, or send a return back to its
// card (a reward stays in Kept until bank payouts, T190). A pledge a bank took back from a reward (T194) shows
// there too, and the balance can then read below zero until the next money in pays it off. A reward in its
// first 14 days says when it can go to a bank (T195). Balance that came from returns kept in Kept can be sent
// back to its card (migration 0080); a reward's waits for bank payouts. A stake paid in crypto says where it went once its
// challenge ended (T170): back to the wallet, on its way, or going to the charity.

import { router } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DayStamp } from '@/components/big-stamp';
import { HabitIcon } from '@/components/habit-icon';
import { ListRow, ListSection } from '@/components/list';
import { MoneyBackRows } from '@/components/money-back';
import { SolanaWalletSection } from '@/components/solana-wallet-section';
import { LoadingScreen } from '@/components/step-screen';
import { StatTile } from '@/components/tile';
import { TabSwipe } from '@/components/tab-swipe';
import { TabTitle } from '@/components/tab-title';
import { money } from '@/lib/challenges';
import { payments } from '@/lib/payment-methods';
import { bankFromText, donationDetail, donationState, KEPT_CREDITS_EXPLAINED, keptBalanceRow, pledgeFate, solanaPayoutText, stakeFate, takebackLabel, walletTotals, type MoneyBack, type MyPledge, type RewardWait, type SolanaPayout } from '@/lib/pledges';
import { supabase } from '@/lib/supabase';
import { SCREEN, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';
import { must, useFocusLoad } from '@/lib/use-focus-load';
import { useMyChallenges } from '@/lib/use-my-challenges';
import { useMyDonations } from '@/lib/use-my-donations';

export default function Wallet() {
  const styles = useStyles(makeStyles);
  const { challenges, failed: challengesFailed, reload: reloadChallenges } = useMyChallenges();
  const { data: pledges, failed, reload } = useFocusLoad(async () => must(await supabase.rpc('my_pledges')) as MyPledge[]);
  const { donations, totalCents: givenCents, failed: donationsFailed, reload: reloadDonations } = useMyDonations();

  const totals = walletTotals(challenges ?? [], pledges ?? []);
  // What's left after credits paid card fees (T164); the same as earned until any are spent.
  const { data: creditsLeft } = useFocusLoad(async () => must(await supabase.rpc('my_credits')) as number);
  const creditsCents = creditsLeft ?? totals.creditsCents;
  // Kept balance and the money waiting for a choice (T189); neither exists where cards aren't real.
  const { data: balance, reload: reloadBalance } = useFocusLoad(async () => {
    const [cents, back, takebacks, waits, toCard] = await Promise.all([
      supabase.rpc('my_balance'),
      supabase.rpc('my_money_back'),
      supabase.rpc('my_takebacks'),
      supabase.rpc('my_reward_waits'),
      supabase.rpc('my_card_returnable'),
    ]);
    return {
      cents: must(cents) as number,
      back: must(back) as MoneyBack[],
      takebacks: must(takebacks) as { id: string; habit: string; amount_cents: number }[],
      waits: must(waits) as RewardWait[],
      toCard: must(toCard) as number,
    };
  });
  // Crypto leaving the treasury (T170); RLS returns only the user's own.
  const { data: solanaPayouts } = useFocusLoad(
    async () => must(await supabase.from('solana_payouts').select('challenge_id, kind, status, signature, amount_cents')) as SolanaPayout[],
  );
  const outcomeOf = (state: string) => (state === 'finished' || state === 'not_finished' || state === 'cancelled' ? state : null);

  /** Sends the balance that came from the user's own returns back to the cards they paid with (migration 0080). */
  function sendToCard(cents: number) {
    Alert.alert(`Send ${money(cents)} back to your card?`, 'It goes back to the card each stake or pledge was paid with. Banks can take 5 to 10 days to show it.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Send it back',
        onPress: async () => {
          try {
            await payments({ action: 'balance-to-card' });
          } catch {
            Alert.alert('Couldn’t send it back', 'Check your connection and try again.');
          }
          reloadBalance();
        },
      },
    ]);
  }

  /** What Kept credits are, behind the (i) on the tile and the heading, so the page itself stays short. */
  const aboutCredits = () => Alert.alert('Kept credits', KEPT_CREDITS_EXPLAINED);

  /** What became of a stake: where its crypto went (T170), or the outcome's words. */
  const stakeLine = (c: { id: string; state: string; charityName: string }) => {
    // A reward on the same challenge is pledges' crypto, not the stake.
    const out = solanaPayouts?.find((p) => p.challenge_id === c.id && p.kind !== 'reward');
    return out ? solanaPayoutText(out, c.charityName) : stakeFate(outcomeOf(c.state), c.charityName);
  };
  /** What became of a pledge: where its crypto went (T171), or the outcome's words. */
  const pledgeLine = (p: MyPledge) => {
    const out = solanaPayouts?.find((o) => o.challenge_id === p.challenge_id && o.kind !== 'reward');
    return out ? solanaPayoutText(out, p.charity) : pledgeFate(p);
  };

  return (
    <TabSwipe tab="wallet">
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="automatic">
          <TabTitle title="Wallet" icon={{ ios: 'wallet.bifold', android: 'account_balance_wallet' }} />
          {/* The totals wait for both stakes and pledges, so they never show $0 while loading. */}
          {challenges && pledges ? (
            <View style={styles.bento}>
              <StatTile value={money(totals.stakedCents)} label="Staked now" style={styles.lead} />
              <StatTile value={money(creditsCents)} label="Kept credits" onInfo={aboutCredits} />
              <StatTile value={money(totals.pledgedCents)} label="Pledged now" />
            </View>
          ) : (
            <LoadingScreen
              inline
              hero
              failed={challengesFailed || failed}
              onRetry={() => {
                reloadChallenges();
                reload();
              }}
              message="Couldn’t load your wallet. Check your connection and try again."
            />
          )}
          <ListSection title="Stakes" titleInside titleIcon={{ ios: 'figure.run', android: 'directions_run' }}>
            {challenges && challenges.length > 0 ? (
              challenges.map((c, i) => (
                <ListRow
                  key={c.id}
                  label={c.title}
                  leading={<StakeMark state={c.state} habitId={c.habitId} />}
                  detail={`$${c.stakeDollars} · ${stakeLine(c)}`}
                  onPress={() => router.push({ pathname: '/challenge/[id]', params: { id: c.id } })}
                  first={i === 0}
                />
              ))
            ) : (
              <ListRow label={challenges ? 'No stakes yet' : 'Loading…'} first />
            )}
          </ListSection>
          <ListSection
            title="Donations"
            titleInside
            titleIcon={{ ios: 'heart', android: 'favorite_border' }}
            footer={
              donations && donations.length > 0
                ? `${money(givenCents)} given to charity for you by Kept, recorded when each challenge ended.`
                : 'Your stake, pledges and extra gifts that go to a charity show here once their challenge ends.'
            }
          >
            {donations && donations.length > 0 ? (
              donations.map((d, i) => (
                <ListRow
                  key={d.id}
                  leading={d.source === 'stake' ? <StakeMark state="not_finished" /> : undefined}
                  label={d.habit}
                  detail={`${money(d.amount_cents)} to ${d.charities?.name ?? 'a charity'} · ${donationDetail(d.source, d.habit)} · ${donationState(d)}`}
                  first={i === 0}
                />
              ))
            ) : (
              <ListRow
                label={donations ? 'No donations yet' : donationsFailed ? 'Couldn’t load your donations' : 'Loading…'}
                detail={!donations && donationsFailed ? 'Tap to try again' : undefined}
                onPress={!donations && donationsFailed ? reloadDonations : undefined}
                first
              />
            )}
          </ListSection>
          {balance && (balance.cents !== 0 || balance.back.length > 0 || balance.takebacks.length > 0) && (
            <ListSection
              title="Kept balance"
              footer="Your own money, kept in Kept: your next stake or pledge uses it first, with no service fee on the part it covers. A reward stays here until bank payouts open."
            >
              <ListRow label="Balance" {...keptBalanceRow(balance.cents)} first />
              {balance.waits.map((w) => (
                <ListRow key={w.challenge_id} label={`Your reward: ${w.habit}`} detail={bankFromText(w.cashable_at)} value={money(w.amount_cents)} />
              ))}
              {balance.takebacks.map((t) => (
                <ListRow key={t.id} label={takebackLabel(t.habit)} value={`−${money(-t.amount_cents)}`} />
              ))}
              {balance.toCard > 0 && (
                <ListRow label="Send it back to your card" detail="What came back from your own stakes and pledges" value={money(balance.toCard)} onPress={() => sendToCard(balance.toCard)} />
              )}
              <MoneyBackRows rows={balance.back} onChanged={reloadBalance} />
            </ListSection>
          )}
          <SolanaWalletSection />
          <ListSection title="Kept credits" onInfo={aboutCredits}>
            <ListRow label="Balance" value={money(creditsCents)} first />
          </ListSection>
          <ListSection title="Your pledges" footer="Pledges you make behind friends’ challenges and public ones.">
            {pledges && pledges.length > 0 ? (
              pledges.map((p, i) => (
                <ListRow
                  key={p.challenge_id}
                  label={`${p.challenger ?? 'A public challenge'}: ${p.habit}`}
                  detail={pledgeLine(p)}
                  value={`$${p.amount_cents / 100}`}
                  onPress={() => router.push({ pathname: '/pledge/[challengeId]', params: { challengeId: p.challenge_id, username: p.challenger } })}
                  first={i === 0}
                />
              ))
            ) : (
              <ListRow
                label={pledges ? 'No pledges yet' : failed ? 'Couldn’t load your pledges' : 'Loading…'}
                detail={!pledges && failed ? 'Tap to try again' : undefined}
                onPress={!pledges && failed ? reload : undefined}
                first
              />
            )}
          </ListSection>
          {pledges && pledges.length === 0 && <Text style={styles.hint}>Open a friend’s profile to back one of their challenges.</Text>}
        </ScrollView>
      </SafeAreaView>
    </TabSwipe>
  );
}

/** A stake's mark at the start of its row: the K box once it came back, the X box once it went to the charity, else the habit. */
function StakeMark({ state, habitId }: { state: string; habitId?: string }) {
  const c = useColors();
  if (state === 'finished') return <DayStamp kind="kept" color={c.stamp} size={36} />;
  if (state === 'not_finished') return <DayStamp kind="missed" color={c.error} size={36} />;
  return <HabitIcon habitId={habitId} look="bare" />;
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.groupedBackground },
    container: { ...SCREEN, gap: SPACE.xl },
    bento: { flexDirection: 'row', gap: SPACE.sm },
    lead: { flex: 1.25 },
    hint: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
  });
