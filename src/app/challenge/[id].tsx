// A challenge's detail screen (as in the A3 mockup, T101: docs/design/mockups/challenge-A3.jpg), in
// this order: the habit's icon, its name and "Day 12 of 28, 1 of 2 shields left"; the days kept as a
// ring alone ("12/28") over today's status; one action ("Check in for today", which opens the
// check-in screen, T25; or an ended challenge's results, T20); then "Your days", Backers and Manage.
// Every number comes from challenge-rules.ts through summarizeChallenge(); this screen has no copy of
// the rules. Development builds also get "Next day" (T19, through the server since T27). The stamp
// card shows every day; tapping one opens its check-in, where a rejected day can be appealed (T29).
// The day after its misses end it, a quiet offer to keep going with a bought shield, and the missed
// days, each marked with whether a shield was bought for it (owner, 2026-10-01). Backers: the total
// pledged with the first three faces, where the stake goes, then each pledge through
// challenge_pledges() (T31): supporters by name, backers by letter (T45); tapping a supporter opens
// who they are (owner, 2026-10-02): a friend's profile, or a preview of someone who isn't a friend
// any more. Backers stay anonymous. Manage: "Public challenge" turns Discover off any time, and on
// until Day 7 (T44); "Your signed promise" opens it as signed (T204); Cancel challenge (until the end of
// Day 1) or Quit challenge (after), both in red ends it early (T52).

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { statusLine } from '@/components/challenge-rows';
import { DemoNextDay } from '@/components/demo-next-day';
import { ErrorText } from '@/components/error-text';
import { ChallengeHeader } from '@/components/habit-icon';
import { ListRow } from '@/components/list';
import { StampCard } from '@/components/stamp-card';
import { MissedDays } from '@/components/missed-days';
import { PersonPreview } from '@/components/person-preview';
import { BottomPanel } from '@/components/profile-fields';
import { RevivalOffer } from '@/components/revival-offer';
import { ProgressRing } from '@/components/progress-ring';
import { LoadingScreen } from '@/components/step-screen';
import { cancelOrQuit, finishedText, money, restartDraft, type ChallengeSummary } from '@/lib/challenges';
import type { FriendRow } from '@/lib/friends';
import { BACKER_WINDOW_DAYS, canMakePublic, explorerUrl, pledgerProfile, type ChallengePledge } from '@/lib/pledges';
import { rescheduleShieldWarnings } from '@/lib/notifications';
import { CardDeclined, payByCard } from '@/lib/payment-methods';
import { askToCancelUnpaid } from '@/lib/solana-pay';
import { supabase } from '@/lib/supabase';
import { FONTS, HERO_MAX_SCALE, RADIUS, SCREEN, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { todayAction } from '@/lib/today';
import { must, useFocusLoad } from '@/lib/use-focus-load';
import { useMyChallenges } from '@/lib/use-my-challenges';

/** Where the stake goes: "Your $25 stake goes {this}." */
function stakeLine(c: ChallengeSummary): string {
  switch (c.state) {
    case 'finished':
    case 'cancelled':
      return 'back to you';
    case 'not_finished':
      return `to ${c.charityName}`;
    default:
      return `to ${c.charityName} if you stop`;
  }
}

/** The check-in button's words, for what today's check-in needs (a redo or an appeal once it didn't pass). */
function checkInButton(c: ChallengeSummary): string {
  switch (todayAction(c)) {
    case 'check-in':
      return 'Check in for today';
    case 'redo':
      return 'Do it again';
    case 'appeal':
      return 'Appeal today’s check-in';
    default:
      return 'See today’s check-in';
  }
}

/** Today's status, in a sentence. */
function todayLine(c: ChallengeSummary): string {
  switch (c.state) {
    case 'upcoming':
      // A Solana stake: the payment and the start in one line, so paying needs no screen of its own (owner, 2026-10-26).
      if (c.awaitingCard) return 'Waiting for your card payment. Day 1 is tomorrow once it goes through.';
      if (c.awaitingPayment) return 'Waiting for your wallet’s payment. Day 1 is tomorrow once it arrives.';
      if (c.paidUpFront) return `Payment received: your $${c.stakeDollars} stake is in, paid with ${c.paymentName}. Day 1 is tomorrow.`;
      return 'Day 1 is tomorrow. Check in once it starts.';
    case 'active':
      return c.todayText ? `Today: ${c.todayText}.` : 'You haven’t checked in today yet.';
    case 'finished':
      return `${finishedText(c.boughtShields)}! Your $${c.stakeDollars} comes back to you.`;
    case 'not_finished':
      return c.revival
        ? `A miss with no shield left ended this challenge on day ${c.endedOnDay}. Your $${c.stakeDollars} goes to ${c.charityName} unless you keep going.`
        : `This challenge ended on day ${c.endedOnDay}. Your $${c.stakeDollars} goes to ${c.charityName}.`;
    case 'cancelled':
      return `You cancelled this challenge. Your $${c.stakeDollars} and any pledges came back; the service fee isn’t refunded.`;
  }
}

export default function ChallengeDetail() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { challenges, failed, reload } = useMyChallenges(id);
  const challenge = challenges?.[0];
  // Who's backing this challenge, reloaded each time the screen comes into view.
  const { data: pledges } = useFocusLoad(async () => must(await supabase.rpc('challenge_pledges', { challenge: id })) as ChallengePledge[], id);
  // The user's friends, to open a supporter's profile; a supporter who isn't one gets a preview.
  const friends = useFocusLoad(async () => must(await supabase.rpc('my_friends')) as FriendRow[]).data ?? [];
  // A crypto stake locked in Kept's escrow program (T231, decision 178): its account, to see it on Solana's explorer.
  const { data: escrow } = useFocusLoad(
    async () => (must(await supabase.from('solana_payments').select('escrow').eq('challenge_id', id).eq('kind', 'stake').maybeSingle()) as { escrow: string | null } | null)?.escrow ?? null,
    id,
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [publicError, setPublicError] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  /** Opens the challenge to backers under Discover, or closes it (the database enforces Day 7). */
  async function setPublic(c: ChallengeSummary, isPublic: boolean) {
    setPublicError(null);
    const { error } = await supabase.from('challenges').update({ is_public: isPublic }).eq('id', c.id);
    if (error) {
      const message = error.message.includes('public_too_late')
        ? `A challenge can be opened to backers only in its first ${BACKER_WINDOW_DAYS} days.`
        : 'Couldn’t change who can back this. Check your connection and try again.';
      setPublicError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } else {
      AccessibilityInfo.announceForAccessibility(isPublic ? 'Backers can find this challenge.' : 'Only friends can back this challenge now.');
    }
    reload();
  }

  /** Closes this screen and opens the Stake step, with the habit and length kept, to pay another way. */
  function startAgain(c: ChallengeSummary) {
    rescheduleShieldWarnings();
    router.dismissAll();
    router.push({ pathname: '/challenge/new/stake', params: restartDraft(c) });
  }

  /** Pays an unpaid card challenge's stake and fee (T93). A declined card removes the challenge (0061), so it says why and offers the start again. */
  async function payNow() {
    if (paying || !challenge) return;
    setPaying(true);
    setEndError(null);
    try {
      await payByCard({ challenge: challenge.id });
      AccessibilityInfo.announceForAccessibility('Payment received. Day 1 is tomorrow.');
    } catch (e) {
      if (e instanceof CardDeclined) {
        const c = challenge;
        Alert.alert('That didn’t go through', `${e.message} Start again to use another card or pay another way.`, [
          { text: 'Not now', style: 'cancel', onPress: () => router.dismissAll() },
          { text: 'Start again', onPress: () => startAgain(c) },
        ]);
        return;
      }
      const message = 'Couldn’t reach Kept. Check your connection and try again.';
      setEndError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      setPaying(false);
      reload();
    }
  }

  /** Removes this unpaid challenge (nothing was taken), then starts it again at the step that picks the way to pay. */
  function payAnotherWay(c: ChallengeSummary) {
    setEndError(null);
    askToCancelUnpaid(
      c.id,
      () => startAgain(c),
      (message) => {
        setEndError(message);
        reload();
      },
      c.awaitingCard,
    );
  }

  /**
   * Cancels (until the end of Day 1: stake and pledges back, fee kept) or quits (counts as not
   * finishing) after asking first; then opens the results. The database checks the day (0026).
   */
  function endEarly(c: ChallengeSummary, kind: 'cancel' | 'quit') {
    // Not paid yet (T169): nothing to give back, so it's removed rather than cancelled.
    if (c.awaitingPayment) {
      setEndError(null);
      return askToCancelUnpaid(
        c.id,
        () => {
          rescheduleShieldWarnings();
          router.dismissAll();
        },
        (message) => {
          setEndError(message);
          reload();
        },
        c.awaitingCard,
      );
    }
    const [title, body, action] =
      kind === 'cancel'
        ? ['Cancel this challenge?', `Your $${c.stakeDollars} and any pledges come back. Kept’s service fee isn’t refunded.`, 'Cancel challenge']
        : ['Quit this challenge?', `It ends now as not finished, and your $${c.stakeDollars} goes to ${c.charityName}, as if you lost your last shield.`, 'Quit challenge'];
    Alert.alert(title, body, [
      { text: 'Keep going', style: 'cancel' },
      {
        text: action,
        style: 'destructive',
        onPress: async () => {
          setEndError(null);
          // The database sets the day and time (0039): today's, for a cancel or a quit.
          const outcome = kind === 'cancel' ? 'cancelled' : 'not_finished';
          const { error } = await supabase.from('challenges').update({ outcome }).eq('id', c.id).is('outcome', null);
          if (error) {
            const message = error.message.includes('cancel_too_late')
              ? 'A challenge can be cancelled only until the end of Day 1. You can quit instead.'
              : error.message.includes('quit_on_day_1')
                ? 'During Day 1 you can cancel instead, and get your stake back.'
                : 'Couldn’t end this challenge. Check your connection and try again.';
            setEndError(message);
            AccessibilityInfo.announceForAccessibility(message);
            return reload();
          }
          reload();
          // An ended challenge warns no more (T35).
          rescheduleShieldWarnings();
          router.push({ pathname: '/challenge/[id]/results', params: { id: c.id } });
        },
      },
    ]);
  }

  if (!challenge) {
    return <LoadingScreen hero failed={challenges !== null || failed} onRetry={reload} message="This challenge couldn’t be loaded." />;
  }

  const running = challenge.state === 'active' || challenge.state === 'upcoming';
  const { daysCompleted, daysRequired } = challenge;
  const endEarlyKind = cancelOrQuit(challenge);
  const pledgedCents = (pledges ?? []).reduce((sum, p) => sum + p.amount_cents, 0);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="automatic">
      <ChallengeHeader habitId={challenge.habitId} title={challenge.title} status={statusLine(challenge)} />

      <View style={styles.ring}>
        <ProgressRing
          value={daysCompleted / daysRequired}
          size={124}
          stroke={11}
          color={colors.stamp}
          trackColor={colors.selected}
          accessibilityLabel={`${daysCompleted} of ${daysRequired} days kept`}
        >
          <Text style={styles.ringNumber} adjustsFontSizeToFit numberOfLines={1} maxFontSizeMultiplier={HERO_MAX_SCALE}>
            {daysCompleted}
            <Text style={styles.ringOf}>/{daysRequired}</Text>
          </Text>
        </ProgressRing>
        <Text style={styles.todayLine}>{todayLine(challenge)}</Text>
        {escrow && !challenge.awaitingPayment && (challenge.state === 'upcoming' || challenge.state === 'active') && (
          <>
            <Text style={styles.todayLine}>
              Your ${challenge.stakeDollars} stake is locked on Solana until the challenge ends: Kept can only send it back to you or to {challenge.charityName}.
            </Text>
            <Button
              title="See it on Solana"
              variant="link"
              onPress={() => Linking.openURL(explorerUrl(escrow, process.env.EXPO_PUBLIC_SOLANA_PAY ?? 'devnet', 'address')).catch(() => {})}
            />
          </>
        )}
      </View>
      <RevivalOffer challenge={challenge} onBought={reload} />
      {/* A card stake not paid yet (T93): pay it here. A Solana one (T169): back to the wallet's sheet. */}
      {challenge.awaitingCard && <Button title={paying ? 'Paying…' : 'Pay by card'} onPress={payNow} disabled={paying} />}
      {challenge.awaitingPayment && !challenge.awaitingCard && (
        <Button title="Finish paying in your wallet" onPress={() => router.push({ pathname: '/challenge/[id]/pay', params: { id: challenge.id } })} />
      )}
      {challenge.awaitingPayment && <Button title="Pay another way" onPress={() => payAnotherWay(challenge)} disabled={paying} variant="link" />}
      {/* One action: today's check-in while it runs, its results once it ends. */}
      {challenge.state === 'active' && (
        <Button
          title={checkInButton(challenge)}
          onPress={() => router.push({ pathname: '/check-in/[challengeId]', params: { challengeId: challenge.id } })}
          variant={todayAction(challenge) ? 'primary' : 'secondary'}
        />
      )}
      {!running && (
        <Button
          title="See results"
          onPress={() => router.push({ pathname: '/challenge/[id]/results', params: { id: challenge.id } })}
        />
      )}
      <DemoNextDay challenge={challenge} onMoved={reload} />

      {challenge.state !== 'upcoming' && (
        <StampCard
          title="Your days"
          challenge={challenge}
          onOpen={(day) => router.push({ pathname: '/check-in/[challengeId]', params: { challengeId: challenge.id, day: String(day) } })}
        />
      )}
      <MissedDays challenge={challenge} />

      {pledges && (
        <View style={styles.section}>
          <View style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={styles.cardTitle} accessibilityRole="header">
                Backers
              </Text>
              {pledges.length > 0 ? (
                <View
                  style={styles.backers}
                  accessible
                  accessibilityLabel={`${money(pledgedCents)} pledged behind you, by ${pledges.length} ${pledges.length === 1 ? 'person' : 'people'}`}
                >
                  <View style={styles.faces}>
                    {pledges.slice(0, 3).map((p, i) => (
                      <View key={p.username ?? p.backer ?? i} style={[styles.face, i > 0 && styles.faceOverlap]}>
                        <Avatar path={p.avatar_path} username={p.username ?? p.backer ?? 'Backer'} size={48} />
                      </View>
                    ))}
                  </View>
                  <View style={styles.backersText}>
                    <Text style={styles.total}>{money(pledgedCents)}</Text>
                    <Text style={styles.cardNote}>pledged behind you</Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.cardNote}>No pledges yet. Friends can back this challenge from your profile.</Text>
              )}
              <Text style={styles.cardNote}>
                Your ${challenge.stakeDollars} stake goes {stakeLine(challenge)}.
              </Text>
            </View>
            {pledges.map((p, i) => {
              const profile = pledgerProfile(p, friends);
              const open =
                profile.kind === 'friend'
                  ? () => router.push({ pathname: '/friend/[id]', params: { id: profile.userId } })
                  : profile.kind === 'preview'
                    ? () => setPreview(profile.username)
                    : undefined;
              const toCharity = p.to_charity_on_finish && p.donate_if_not_finished
                ? `Gives to ${challenge.charityName} either way`
                : p.to_charity_on_finish
                  ? `Gives to ${challenge.charityName} if you finish`
                  : p.donate_if_not_finished
                    ? `Your reward if you finish, ${challenge.charityName} if not`
                    : null;
              const notes = [toCharity, profile.kind === 'anonymous' ? 'A backer, anonymous' : null];
              return (
                <ListRow
                  key={p.username ?? p.backer ?? i}
                  leading={p.username ? <Avatar path={p.avatar_path} username={p.username} size={32} /> : undefined}
                  label={p.username ?? p.backer ?? 'Backer'}
                  detail={notes.filter(Boolean).join(' · ') || undefined}
                  value={`$${p.amount_cents / 100}`}
                  onPress={open}
                />
              );
            })}
          </View>
          <Text style={styles.footer}>Tap a supporter to see who they are. Backers stay anonymous, to you too.</Text>
        </View>
      )}

      {/* Manage, last: who can back it, the signed promise (T204), and ending it early (Quit in red; Cancel isn't,
          since it gives the stake back). */}
      <View style={styles.section}>
        <View style={styles.group}>
          <Text style={styles.manageLabel}>Manage</Text>
          {running && (
            <ListRow
              icon={{ ios: 'person.2', android: 'group' }}
              label="Public challenge"
              toggle={{
                value: challenge.isPublic,
                onValueChange: (value) => setPublic(challenge, value),
                disabled: !challenge.isPublic && !canMakePublic(challenge),
              }}
              first
            />
          )}
          <ListRow
            icon={{ ios: 'signature', android: 'draw' }}
            label="Your signed promise"
            onPress={() => router.push({ pathname: '/challenge/[id]/promise', params: { id: challenge.id } })}
            first={!running}
          />
          {endEarlyKind && (
            <ListRow
              icon={endEarlyKind === 'quit' ? { ios: 'rectangle.portrait.and.arrow.right', android: 'logout' } : { ios: 'arrow.uturn.backward', android: 'undo' }}
              label={endEarlyKind === 'cancel' ? 'Cancel challenge' : 'Quit challenge'}
              destructive
              onPress={() => endEarly(challenge, endEarlyKind)}
            />
          )}
        </View>
        {(running || endEarlyKind) && (
          <Text style={styles.footer}>
            {[
              running &&
                (challenge.isPublic
                  ? `Public: people who aren’t your friends can find it under Discover, without your name, and pledge until Day ${BACKER_WINDOW_DAYS}. Turning this off hides it; backers who pledged keep seeing its progress.`
                  : canMakePublic(challenge)
                    ? `Only your friends can back it. Make it public to let backers find it, until Day ${BACKER_WINDOW_DAYS}.`
                    : `Only your friends can back it. Challenges open to backers only in their first ${BACKER_WINDOW_DAYS} days.`),
              endEarlyKind === 'cancel'
                ? 'Until the end of Day 1, cancelling returns your stake and any pledges. The service fee isn’t refunded.'
                : endEarlyKind === 'quit'
                  ? 'Quitting ends it as not finished: your stake goes to the charity.'
                  : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </Text>
        )}
        <ErrorText message={publicError} />
        <ErrorText message={endError} />
      </View>

      <BottomPanel visible={preview !== null} title="Who’s backing you" buttonTitle="Close" onClose={() => setPreview(null)}>
        {preview && (
          <View style={styles.sheet}>
            <PersonPreview username={preview} />
            <Text style={styles.note}>They backed you as a friend. You can send them a new friend request from Friends.</Text>
          </View>
        )}
      </BottomPanel>
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: SCREEN,
    ring: { alignItems: 'center', gap: SPACE.md },
    ringNumber: { ...TYPE.stat, color: c.text, paddingHorizontal: SPACE.md },
    ringOf: { ...TYPE.heading, fontFamily: FONTS.heavy, color: c.text },
    todayLine: { ...TEXT.note, color: c.secondaryText, textAlign: 'center', marginHorizontal: SPACE.lg },
    note: { ...TEXT.caption, color: c.secondaryText, textAlign: 'center' },
    section: { gap: SPACE.sm },
    // A card with its own head (Backers, Manage) and rows under it, like a list group.
    group: { backgroundColor: c.card, borderRadius: RADIUS.tile, borderCurve: 'continuous', overflow: 'hidden', boxShadow: c.tileShadow || undefined },
    groupHead: { padding: SPACE.lg, gap: SPACE.md },
    cardTitle: { ...TYPE.title, color: c.text },
    cardNote: { ...TEXT.note, color: c.secondaryText },
    backers: { flexDirection: 'row', alignItems: 'center', gap: SPACE.lg },
    faces: { flexDirection: 'row' },
    face: { borderRadius: RADIUS.pill, borderWidth: 2, borderColor: c.card },
    faceOverlap: { marginLeft: -SPACE.md },
    backersText: { flex: 1 },
    total: { ...TYPE.stat, color: c.text },
    manageLabel: { ...TEXT.note, color: c.secondaryText, paddingHorizontal: SPACE.lg, paddingTop: SPACE.md },
    footer: { ...TEXT.caption, color: c.secondaryText, marginHorizontal: SPACE.sm },
    sheet: { gap: SPACE.md, padding: SPACE.lg },
  });
