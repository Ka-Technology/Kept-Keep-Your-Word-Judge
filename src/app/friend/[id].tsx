// A friend's profile (T23, SPEC-friends.md): their photo (tap to see it large) and username, completion rate ("3 of 5,
// 60%") and success marks, the challenges they have running (each opens its pledge screen, T31), and Remove friend. The database
// decides what's readable (0012): only accepted friends get the challenges, and unfriending ends
// that at once. Every number comes from challenge-rules.ts through summarizeChallenge(). The
// completion rate is a ring beside the success marks (bento, 2026-10-02). As in the A3 mockup since
// T123 (full-set/ui-push-4-friend.jpg): the photo beside @username, large (a friend never sees your
// name, decision 100), each running challenge as a card with its days and Back this challenge, the
// completion rate and badges kept below (See all opens every badge of theirs, T210), then Remove friend, Block and Report as red rows.

import { router, useLocalSearchParams } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { BadgeTile } from '@/components/badge';
import { Button } from '@/components/button';
import { statusLine } from '@/components/challenge-rows';
import { HabitIcon } from '@/components/habit-icon';
import { ListRow, ListScreen, ListSection } from '@/components/list';
import { TappableAvatar } from '@/components/photo-viewer';
import { ProgressRing } from '@/components/progress-ring';
import { reportBlockActions } from '@/components/report-block';
import { StampCard } from '@/components/stamp-card';
import { LoadingScreen } from '@/components/step-screen';
import { StatTile, Tile } from '@/components/tile';
import { badgesFor, rarityOf, showcaseFirst } from '@/lib/badges';
import { CHALLENGE_COLUMNS, completionRateText, meStats, summarizeChallenge, type ChallengeRow } from '@/lib/challenges';
import type { FriendRow } from '@/lib/friends';
import { supabase } from '@/lib/supabase';
import { HERO_MAX_SCALE, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { useBadgeExtras, useBadgeShares } from '@/lib/use-badge-extras';
import { must, useFocusLoad } from '@/lib/use-focus-load';

export default function FriendProfile() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const extras = useBadgeExtras(id);
  const shares = useBadgeShares();

  // Reloads each time the screen comes into view.
  const { data, failed, reload } = useFocusLoad(async () => {
    const [friends, rows] = await Promise.all([
      supabase.rpc('my_friends'),
      supabase.from('challenges').select(CHALLENGE_COLUMNS).eq('user_id', id).order('created_at', { ascending: false }),
    ]);
    const now = new Date();
    return {
      // null once it's clear you aren't friends (any more).
      friend: (must(friends) as FriendRow[]).find((f) => f.user_id === id && f.status === 'accepted') ?? null,
      challenges: (must(rows) as unknown as ChallengeRow[]).map((row) => summarizeChallenge(row, now)),
    };
  }, id);

  if (!data) {
    return <LoadingScreen failed={failed} onRetry={reload} message="Couldn’t load this profile. Check your connection and try again." />;
  }
  const { friend, challenges } = data;
  if (friend === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>You’re not friends with them any more.</Text>
        <Button title="Go back" onPress={() => router.back()} variant="secondary" />
      </View>
    );
  }

  const stats = meStats(challenges);
  const running = challenges.filter((c) => c.state === 'active' || c.state === 'upcoming');

  /** Unfriending can't be undone without a new request, so ask first. */
  function confirmRemove(f: FriendRow) {
    Alert.alert(`Remove ${f.username}?`, 'You’ll stop seeing each other’s challenges. You can send a new request later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove friend',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('friendships').delete().eq('id', f.friendship_id);
          if (error) Alert.alert('Couldn’t remove them', 'Check your connection and try again.');
          else router.back();
        },
      },
    ]);
  }

  const { openReport, confirmBlock } = reportBlockActions({
    report: { reportedId: id },
    block: { user: id },
    name: `@${friend.username}`,
    onBlocked: () => router.back(),
  });

  return (
    <ListScreen>
      <View style={styles.header}>
        <TappableAvatar path={friend.avatar_path} username={friend.username} size={104} />
        <Text style={styles.username} accessibilityRole="header" adjustsFontSizeToFit numberOfLines={2} maxFontSizeMultiplier={HERO_MAX_SCALE}>
          @{friend.username}
        </Text>
      </View>
      {running.map((c) => (
        <StampCard
          key={c.id}
          challenge={c}
          header={
            <View style={styles.cardHead}>
              <HabitIcon habitId={c.habitId} look="bare" />
              <View style={styles.cardTitles}>
                <Text style={styles.cardTitle}>{c.title}</Text>
                <Text style={styles.cardStatus}>{statusLine(c)}</Text>
              </View>
            </View>
          }
        >
          <Button
            title="Back this challenge"
            onPress={() => router.push({ pathname: '/pledge/[challengeId]', params: { challengeId: c.id, username: friend.username } })}
          />
        </StampCard>
      ))}
      {running.length === 0 && <Text style={styles.empty}>No challenges running right now.</Text>}
      <View style={styles.bento}>
        <Tile style={styles.rateTile}>
          <ProgressRing
            value={stats.ended ? stats.percent / 100 : 0}
            size={96}
            stroke={10}
            color={colors.stamp}
            trackColor={colors.selected}
            accessibilityLabel={`Completion rate: ${completionRateText(stats)}`}
          >
            <Text style={styles.number} maxFontSizeMultiplier={HERO_MAX_SCALE}>
              {stats.ended ? `${stats.percent}%` : '–'}
            </Text>
          </ProgressRing>
          <Text style={styles.caption}>{stats.ended ? completionRateText(stats) : 'No challenges ended yet'}</Text>
        </Tile>
        <StatTile value={String(stats.finished)} label="success marks" />
      </View>
      <BadgeTile earned={showcaseFirst(badgesFor(challenges, extras), extras.showcase, rarityOf(shares))} seeAll of={{ id, username: friend.username }} />
      <ListSection footer="Blocking ends the friendship and hides you from each other; they aren't told.">
        <ListRow label="Remove friend" icon={{ ios: 'person.badge.minus', android: 'person_remove' }} onPress={() => confirmRemove(friend)} destructive first />
        <ListRow label={`Block @${friend.username}`} icon={{ ios: 'nosign', android: 'block' }} onPress={confirmBlock} destructive />
        <ListRow label={`Report @${friend.username}`} icon={{ ios: 'flag', android: 'flag' }} onPress={openReport} destructive />
      </ListSection>
    </ListScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xl, marginHorizontal: SPACE.xs },
    username: { ...TYPE.display, color: c.text, flex: 1 },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.sm },
    cardTitles: { flex: 1, gap: SPACE.xxs },
    cardTitle: { ...TYPE.title, color: c.text },
    cardStatus: { ...TEXT.row, color: c.secondaryText },
    bento: { flexDirection: 'row', gap: SPACE.md },
    rateTile: { flex: 1.3, alignItems: 'center', gap: SPACE.sm },
    number: { ...TYPE.stat, color: c.text },
    caption: { ...TEXT.caption, color: c.secondaryText },
    empty: { ...TEXT.body, color: c.secondaryText, marginHorizontal: SPACE.xs },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.lg, padding: SPACE.xxl, backgroundColor: c.groupedBackground },
  });
