// Home (owner interview, 2026-09-27; A3 mockup, T100: docs/design/mockups/home-A3.jpg): a summary
// at a glance. The date and "Good evening, {username}", then one wide tile about one challenge
// (featuredChallenge(): a check-in to redo, the soonest due, one to appeal, then the first running):
// its title, a big ring of days kept "of N days", and on the right what today needs (a green Check
// in, a red Redo or Appeal, the K box once it's kept). Two small tiles below hold that challenge's
// stake and shields left. Then a card for each other running challenge, with its last seven days as
// stamps over their weekdays and who's backing it (pledge_summaries(), T31). Nothing is listed
// twice. With nothing running, a tile that starts a challenge. Last, once anything has gone to charity
// in your name, how much (the donations table's total, as on Me and in Wallet: T208, decision 173).
// The first time each user lands here on this device, it opens the tutorial.

import { router } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DayStamp } from '@/components/big-stamp';
import { Button } from '@/components/button';
import { ChallengeCard } from '@/components/challenge-card';
import { ProgressRing } from '@/components/progress-ring';
import { LoadingScreen } from '@/components/step-screen';
import { StatTile, Tile } from '@/components/tile';
import { TabSwipe } from '@/components/tab-swipe';
import { ProfileButton } from '@/components/tab-title';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/challenges';
import { pledgeSummaryText, type PledgeSummary } from '@/lib/pledges';
import { supabase } from '@/lib/supabase';
import { HERO_MAX_SCALE, SCREEN, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { loadGreetBy } from '@/lib/greet-by';
import { dueSoonest, featuredChallenge, greeting, greetingName, recentStamps, timeLeft } from '@/lib/today';
import { hasSeenTutorial } from '@/lib/tutorial';
import { must, useFocusLoad } from '@/lib/use-focus-load';
import { useMyChallenges } from '@/lib/use-my-challenges';
import { useMyDonations } from '@/lib/use-my-donations';
import { useNow } from '@/lib/use-now';

type Featured = NonNullable<ReturnType<typeof featuredChallenge>>;

export default function Home() {
  const styles = useStyles(makeStyles);
  const { profile, session } = useAuth();
  const userId = session?.user.id;
  const now = useNow();
  // Read again each time Home comes into view, so a change in Settings → App shows at once.
  const greetBy = useFocusLoad(loadGreetBy).data ?? 'name';
  const { challenges, failed, reload } = useMyChallenges();
  const { totalCents: givenCents } = useMyDonations();
  const running =(challenges ?? []).filter((c) => c.state === 'upcoming' || c.state === 'active');
  const runningIds = running.map((c) => c.id).join(',');

  // Pledge totals for the running challenges, refreshed on focus and whenever the list of them changes.
  const backing =
    useFocusLoad(async () => must(await supabase.rpc('pledge_summaries', { ids: runningIds.split(',') })) as PledgeSummary[], runningIds || null).data ?? [];

  // Show the tutorial once per user (right after sign-up, for a new account).
  useEffect(() => {
    if (!userId) return;
    let current = true;
    hasSeenTutorial(userId).then((seen) => {
      if (current && !seen) router.push('/tutorial');
    });
    return () => {
      current = false;
    };
  }, [userId]);

  // e.g. "Saturday, October 18", in the phone's language and time zone.
  const today = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const featured = featuredChallenge(running, now);
  const others = running.filter((c) => c.id !== featured?.challenge.id);
  const backingFor = (id: string) => {
    const s = backing.find((b) => b.challenge_id === id);
    return s && s.pledgers > 0 ? pledgeSummaryText({ totalCents: s.total_cents, pledgers: s.pledgers }) : undefined;
  };

  return (
    <TabSwipe tab="index">
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="automatic">
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.date}>{today}</Text>
              <Text style={styles.greeting} accessibilityRole="header">
                {greeting(now.getHours())}{profile && `, ${greetingName(profile, greetBy)}`}
              </Text>
            </View>
            <ProfileButton />
          </View>

          {challenges === null ? (
            // Until the challenges load, say so, rather than a row of zeros.
            <LoadingScreen inline hero failed={failed} onRetry={reload} message="Couldn’t load your challenges. Check your connection and try again." />
          ) : !featured ? (
            <StartTile first={challenges.length === 0} />
          ) : (
            <>
              <FeaturedTile featured={featured} dueToday={dueSoonest(running, now).length} />
              <View style={styles.bento}>
                <StatTile icon={{ ios: 'wallet.bifold', android: 'account_balance_wallet' }} value={`$${featured.challenge.stakeDollars}`} label="on it" />
                <StatTile
                  icon={{ ios: 'shield', android: 'shield' }}
                  value={String(featured.challenge.shieldsLeft)}
                  label={featured.challenge.shieldsLeft === 1 ? 'shield left' : 'shields left'}
                />
              </View>
              {others.map((c) => (
                <ChallengeCard key={c.id} challenge={c} backing={backingFor(c.id)} />
              ))}
            </>
          )}
          {givenCents > 0 && <StatTile icon={{ ios: 'heart', android: 'favorite_border' }} value={money(givenCents)} label="given to charity so far" />}
        </ScrollView>
      </SafeAreaView>
    </TabSwipe>
  );
}

/**
 * The wide tile: one challenge's title, its ring of days kept "of N days", and what today needs. A
 * check-in opens its camera straight away where that's the only way (or Check in, when several are
 * due); a redo or an appeal turns the tile red and opens the check-in; otherwise the tile opens the
 * challenge.
 */
function FeaturedTile({ featured, dueToday }: { featured: Featured; dueToday: number }) {
  const c = useColors();
  const styles = useStyles(makeStyles);
  const { challenge: f, action, minutes } = featured;
  const left = minutes === null ? '' : timeLeft(minutes);
  const red = action === 'redo' || action === 'appeal';
  const keptToday = f.state === 'active' && recentStamps(f).at(-1)?.kind === 'kept';
  const label = action === 'redo' ? 'Do it again' : action === 'appeal' ? 'Not approved' : null;
  const note =
    action === 'check-in'
      ? dueToday > 1
        ? `${dueToday} due today · ${left}`
        : left
      : action === 'redo'
        ? `${f.todayText ?? 'Asked for a new check-in'} · ${left}`
        : action === 'appeal'
          ? 'You can appeal it within 7 days'
          : f.state === 'upcoming'
            ? 'Starts tomorrow'
            : keptToday
              ? 'Kept today'
              : (f.todayText ?? 'Checked in today');
  const button = action === 'check-in' ? 'Check in' : action === 'redo' ? 'Redo' : action === 'appeal' ? 'Appeal' : null;
  const several = (action === 'check-in' || action === 'redo') && dueToday > 1;
  const open = () =>
    several
      ? router.navigate('/check-in')
      : action === 'check-in'
        ? router.push({ pathname: '/check-in/[challengeId]', params: { challengeId: f.id, day: String(f.today), start: '1' } })
        : action
          ? router.push({ pathname: '/check-in/[challengeId]', params: { challengeId: f.id } })
          : router.push({ pathname: '/challenge/[id]', params: { id: f.id } });

  return (
    <Tile
      tone={red ? 'alert' : 'plain'}
      style={styles.featured}
      onPress={open}
      accessibilityLabel={[label, f.title, `${f.daysCompleted} of ${f.daysRequired} days kept`, note, button].filter(Boolean).join('. ')}
      accessibilityHint={several ? 'Opens Check in' : action ? 'Opens the check-in' : 'Opens the challenge'}
    >
      {label && <Text style={[styles.label, styles.red]}>{label}</Text>}
      <Text style={styles.featuredTitle} numberOfLines={2}>
        {f.title}
      </Text>
      <View style={styles.featuredRow}>
        <ProgressRing
          value={f.daysCompleted / f.daysRequired}
          size={112}
          stroke={11}
          color={c.stamp}
          trackColor={c.selected}
          accessibilityLabel={`${f.daysCompleted} of ${f.daysRequired} days kept`}
        >
          <Text style={styles.ringNumber} adjustsFontSizeToFit numberOfLines={1} maxFontSizeMultiplier={HERO_MAX_SCALE}>
            {f.daysCompleted}
          </Text>
        </ProgressRing>
        <View style={styles.featuredText}>
          <Text style={styles.of}>of {f.daysRequired} days</Text>
          {!!note && <Text style={[styles.note, red && styles.red]}>{note}</Text>}
        </View>
        {button ? (
          <Button title={button} onPress={open} variant={red ? 'destructive' : 'primary'} compact />
        ) : (
          keptToday && <DayStamp kind="kept" color={c.stamp} size={56} />
        )}
      </View>
    </Tile>
  );
}

/** With nothing running: a tile that invites a first (or next) challenge. */
function StartTile({ first }: { first: boolean }) {
  const styles = useStyles(makeStyles);
  const start = () => router.push('/challenge/new');
  return (
    <Tile onPress={start} accessibilityLabel="Start a challenge">
      <Text style={styles.featuredTitle}>{first ? 'Put your word on a habit.' : 'Ready for the next one?'}</Text>
      <Text style={styles.body}>
        {first
          ? 'Stake on a habit, check in every day, and give to charity while you do it.'
          : 'Nothing running right now. Start a challenge, or track a habit for free.'}
      </Text>
      <Button title="Start a challenge" onPress={start} />
    </Tile>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    container: { ...SCREEN, gap: SPACE.lg },
    header: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginTop: SPACE.sm, marginBottom: SPACE.sm, marginHorizontal: SPACE.xs },
    headerText: { flex: 1 },
    date: { ...TEXT.row, color: c.secondaryText },
    greeting: { ...TYPE.display, color: c.text },
    bento: { flexDirection: 'row', gap: SPACE.lg },
    featured: { gap: SPACE.md, padding: SPACE.xl },
    label: { ...TEXT.caption, fontWeight: '600' },
    red: { color: c.error },
    featuredTitle: { ...TYPE.title, color: c.text },
    featuredRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.lg },
    ringNumber: { ...TYPE.hero, color: c.text, paddingHorizontal: SPACE.md },
    featuredText: { flex: 1, gap: SPACE.xs },
    of: { ...TEXT.row, color: c.secondaryText },
    note: { ...TEXT.caption, color: c.secondaryText },
    body: { ...TEXT.body, color: c.secondaryText },
  });
