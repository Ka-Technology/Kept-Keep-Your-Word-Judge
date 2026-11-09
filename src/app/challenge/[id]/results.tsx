// A challenge's results (T20; as in the A3 mockups since T103: docs/design/mockups/results-A3.jpg
// and "results missed" in full-set/sheet-flow.jpg), shown as a sheet with an X to close it. A finish
// opens with the K stamp landing, "You kept it" and the amount back counting up (T98); an unfinished
// challenge with the red X box and "Not this time", quietly. Then the two numbers that matter most as
// tiles (where the stake went, and the charity's total), any badge this ending earned (owner,
// 2026-10-02), the quiet "Keep going?" offer of a bought shield the day after its misses end it
// (owner, 2026-10-01), and Share your finish card or Start another challenge. Below: where every
// (pretend) dollar goes, from settle() through settlementLines() (the stake, each pledge, extra gifts
// and the charity's total, T32), how it reaches the charity (T61), an extra gift, and the finish card
// for Instagram Stories and the like, which Share sends to the phone's share sheet as a picture. It
// opens when the app first sees the challenge end, and from "See results".

import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, View, type ViewInstance } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { BadgeSeal } from '@/components/badge';
import { BigStamp, DayStamp } from '@/components/big-stamp';
import { Button } from '@/components/button';
import { FinishCard } from '@/components/finish-card';
import { GiftForm } from '@/components/gift-form';
import { ListRow, ListSection } from '@/components/list';
import { MoneyBackRows } from '@/components/money-back';
import { DemoNextDay } from '@/components/demo-next-day';
import { RevivalOffer } from '@/components/revival-offer';
import { LoadingScreen } from '@/components/step-screen';
import { StatTile, Tile } from '@/components/tile';
import { useAuth } from '@/lib/auth';
import { BADGE_BY_ID, badgesFor, endingBadges } from '@/lib/badges';
import { donationRoute, finishedText, money as amountText, settlementLines, type ChallengeSummary } from '@/lib/challenges';
import { bankFromText, explorerUrl, solanaPayoutText, type ChallengePledge, type MoneyBack, type RewardWait, type SolanaPayout } from '@/lib/pledges';
import { supabase } from '@/lib/supabase';
import { ICON, SCREEN, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { must, useFocusLoad } from '@/lib/use-focus-load';
import { useMyChallenges } from '@/lib/use-my-challenges';

export default function Results() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { profile } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  // All of them, to tell which badges this ending earned (a first finish, a third, …).
  const { challenges: all, failed, reload } = useMyChallenges();
  const challenge = all?.find((c) => c.id === id);
  const newBadges = challenge ? endingBadges(badgesFor(all ?? []), challenge) : [];
  // The pledges and extra gifts, reloaded when the screen comes into view and after a gift.
  const { data: money, reload: loadMoney } = useFocusLoad(async () => {
    const [p, g] = await Promise.all([supabase.rpc('challenge_pledges', { challenge: id }), supabase.rpc('extra_gift_summary', { challenge: id })]);
    return { pledges: must(p) as ChallengePledge[], giftsCents: (must(g) as { total_cents: number }[])[0]?.total_cents ?? 0 };
  }, id);
  const lines = challenge ? settlementLines(challenge, money ?? {}) : [];
  // This challenge's money waiting for the user's choice (T189): keep it in Kept, or send it back. Its reward is
  // already in Kept balance (T198), and says when it can go to a bank (T195).
  const { data: moneyBack, reload: loadMoneyBack } = useFocusLoad(async () => {
    const [back, waits, crypto] = await Promise.all([
      supabase.rpc('my_money_back'),
      supabase.rpc('my_reward_waits'),
      // A stake paid in crypto, leaving the treasury (T170).
      supabase.from('solana_payouts').select('challenge_id, kind, status, signature, amount_cents').eq('challenge_id', id),
    ]);
    return {
      back: (must(back) as (MoneyBack & { challenge_id: string })[]).filter((m) => m.challenge_id === id),
      reward: (must(waits) as RewardWait[]).find((w) => w.challenge_id === id),
      crypto: must(crypto) as SolanaPayout[],
    };
  }, id);
  const card = useRef<ViewInstance>(null);
  const [sharing, setSharing] = useState(false);

  /** Shares the finish card as a picture; if it can't be taken, shares a line about the finish instead. */
  async function share(c: ChallengeSummary) {
    setSharing(true);
    try {
      // ponytail: iOS takes a file through Share; Android (after the demo, T13) needs expo-sharing for files.
      const url = await captureRef(card, { format: 'png', result: 'tmpfile' });
      await Share.share({ url });
    } catch {
      await Share.share({ message: `I finished my ${c.lengthDays}-day “${c.title}” challenge on Kept!` }).catch(() => {});
    } finally {
      setSharing(false);
    }
  }

  const closeButton = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={SPACE.md}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <SymbolView name={{ ios: 'xmark', android: 'close' }} size={ICON.row - 2} tintColor={colors.text} />
          </Pressable>
        ),
      }}
    />
  );

  if (!challenge) {
    return (
      <>
        {closeButton}
        <LoadingScreen hero failed={all !== null || failed} onRetry={reload} message="These results couldn’t be loaded." />
      </>
    );
  }
  if (lines.length === 0) {
    return (
      <View style={styles.center}>
        {closeButton}
        <Text style={styles.body}>This challenge is still running. Its results show once it ends.</Text>
      </View>
    );
  }

  const finished = challenge.state === 'finished';
  const cancelled = challenge.state === 'cancelled';
  const charityTotal = lines.find((l) => l.label.startsWith('Total to'));
  const startAnother = () => {
    router.dismissAll();
    router.push('/challenge/new');
  };
  const how = cancelled
    ? `You cancelled it before Day 1 ended. Your $${challenge.stakeDollars} and any pledges came back; Kept’s service fee isn’t refunded.`
    : challenge.quit
      ? `You quit on day ${challenge.endedOnDay}. Your $${challenge.stakeDollars} goes to ${challenge.charityName}.`
      : challenge.state === 'not_finished'
        ? `The challenge ended on day ${challenge.endedOnDay}, a miss with no shield left. Your $${challenge.stakeDollars} goes to ${challenge.charityName}.`
        : challenge.boughtShields
          ? `${finishedText(challenge.boughtShields)}. Your $${challenge.stakeDollars} comes back to you.`
          : null;

  return (
    <View style={styles.screen}>
      {closeButton}
      <ScrollView contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        {/* The ending as a stamp (A3, T103; T98): a finish sets down the green K box with a success tap,
            and the amount back counts up as it lands; an unfinished one shows the red X box, quietly. */}
        <View style={styles.hero}>
          {finished && <BigStamp color={colors.stamp} animate size={112} centered />}
          {challenge.state === 'not_finished' && (
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <DayStamp kind="missed" color={colors.error} size={112} />
            </View>
          )}
          <Text style={styles.title} accessibilityRole="header">
            {finished ? 'You kept it' : cancelled ? 'Cancelled' : 'Not this time'}
          </Text>
          <Text style={styles.subtitle}>
            {challenge.daysCompleted} of {challenge.daysRequired} days, {challenge.title}
          </Text>
          {how && <Text style={styles.how}>{how}</Text>}
        </View>

        <View style={styles.money}>
          <View style={styles.bento}>
            {/* The stake back to you counts up in green; to the charity, in ink. */}
            <StatTile value={lines[0].value} label={lines[0].label} green={challenge.state !== 'not_finished'} countUp={finished} big style={styles.amount} />
            {charityTotal && <StatTile value={charityTotal.value} label={charityTotal.label} green={finished} big style={styles.amount} />}
          </View>
        </View>

        {challenge.state === 'not_finished' && (
          // Back to the challenge's detail screen if it's under this sheet (the usual way here), not a second copy of it.
          <RevivalOffer card challenge={challenge} onBought={() => router.dismissTo({ pathname: '/challenge/[id]', params: { id: challenge.id } })} />
        )}
        <DemoNextDay challenge={challenge} onMoved={reload} />

        {newBadges.length > 0 && (
          <View style={styles.badges}>
            <Text style={styles.heading} accessibilityRole="header">
              New badges
            </Text>
            <View style={styles.badgeGrid}>
              {newBadges.map((b) => (
                <Tile key={b.id} style={styles.badge} accessibilityLabel={`New badge: ${BADGE_BY_ID.get(b.id)?.name}`}>
                  <BadgeSeal id={b.id} size={80} />
                  <Text style={styles.badgeName} numberOfLines={2}>
                    {BADGE_BY_ID.get(b.id)?.name}
                  </Text>
                </Tile>
              ))}
            </View>
          </View>
        )}

        {finished ? (
          <>
            <Button title={sharing ? 'Getting it ready…' : 'Share your finish card'} onPress={() => share(challenge)} disabled={sharing} />
            <Button title="Start another challenge" onPress={startAnother} variant="link" />
          </>
        ) : (
          <Button title="Start another challenge" onPress={startAnother} />
        )}

        {/* Kept below the mockup's screen: every dollar, how it reaches the charity, the gift, and the card to share. */}
        {moneyBack && moneyBack.crypto.length > 0 && challenge && (
          <ListSection title="Your crypto" footer={moneyBack.crypto.some((o) => o.signature) ? 'Tap one to see its transaction on Solana.' : undefined}>
            {moneyBack.crypto.map((o, i) => (
              <ListRow
                key={`${o.kind}-${i}`}
                label={o.kind === 'reward' ? 'A pledge, your reward' : 'Your stake'}
                detail={solanaPayoutText(o, challenge.charityName)}
                value={amountText(o.amount_cents)}
                onPress={o.signature ? () => Linking.openURL(explorerUrl(o.signature!, process.env.EXPO_PUBLIC_SOLANA_PAY ?? 'devnet')) : undefined}
                first={i === 0}
              />
            ))}
          </ListSection>
        )}
        {moneyBack && (moneyBack.back.length > 0 || moneyBack.reward) && (
          <ListSection title="Your money" footer="Keep it in Kept to use on your next stake or pledge with no service fee, or send it back.">
            {moneyBack.reward && (
              <ListRow label="Your reward, in your Kept balance" detail={bankFromText(moneyBack.reward.cashable_at)} value={amountText(moneyBack.reward.amount_cents)} first />
            )}
            <MoneyBackRows rows={moneyBack.back} onChanged={loadMoneyBack} first={!moneyBack.reward} />
          </ListSection>
        )}
        <ListSection title="Where the money goes">
          {lines.map((line, i) => (
            <ListRow key={line.label} label={line.label} value={line.value} first={i === 0} />
          ))}
        </ListSection>
        <ListSection title={`How it reaches ${challenge.charityName}`}>
          {donationRoute(challenge.charityName).map((step, i) => (
            <ListRow key={step.label} label={step.label} detail={step.detail} first={i === 0} />
          ))}
        </ListSection>
        {!cancelled && <GiftForm challengeId={challenge.id} charityName={challenge.charityName} onSaved={loadMoney} />}
        {finished && (
          <View style={styles.badges}>
            <Text style={styles.heading} accessibilityRole="header">
              Your finish card
            </Text>
            <FinishCard ref={card} challenge={challenge} username={profile?.username ?? ''} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: SCREEN,
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.md, padding: SPACE.xxl, backgroundColor: c.groupedBackground },
    pressed: { opacity: 0.7 },
    body: { ...TEXT.body, color: c.text },
    hero: { alignItems: 'center', gap: SPACE.sm },
    title: { ...TYPE.hero, color: c.text, textAlign: 'center', marginTop: SPACE.sm },
    subtitle: { ...TEXT.row, color: c.secondaryText, textAlign: 'center' },
    how: { ...TEXT.note, color: c.secondaryText, textAlign: 'center', marginHorizontal: SPACE.lg },
    money: { gap: SPACE.sm },
    bento: { flexDirection: 'row', gap: SPACE.md },
    amount: { minHeight: 140, alignItems: 'center', justifyContent: 'center' },
    badges: { gap: SPACE.md },
    heading: { ...TYPE.title, color: c.text, marginHorizontal: SPACE.xs },
    badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md, justifyContent: 'center' },
    badge: { width: '46%', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.xl },
    badgeName: { ...TEXT.row, color: c.secondaryText, textAlign: 'center' },
  });
