// The leaderboard on the Friends tab (T89, plan.md decision 88; as in the A3 mockups since T107,
// full-set/sheet-lb.jpg): one card with two switches (Days kept / Streak / Badges, and This week /
// All time under Days kept, decision 98), then you and your friends ranked. This week leads with
// your own number and where you stand ("You and @taylor share 1st"). Your row is highlighted. Tapping
// a friend opens their profile, and yourself your own. Numbers only, never amounts (lib/leaderboard.ts).
// With no friends yet, the K box, an invitation and Share my profile.

import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { DayStamp } from '@/components/big-stamp';
import { Button } from '@/components/button';
import { Chevron } from '@/components/list';
import { Segmented } from '@/components/segmented';
import { BADGES } from '@/lib/badges';
import type { FriendRow } from '@/lib/friends';
import { boardRows, boardSummary, valueText, type Board } from '@/lib/leaderboard';
import { FONTS, ICON, RADIUS, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { useLeaderboard } from '@/lib/use-leaderboard';

const KINDS = [
  { value: 'days', label: 'Days kept' },
  { value: 'streak', label: 'Streak' },
  { value: 'badges', label: 'Badges' },
] as const;

const PERIODS = [
  { value: 'week', label: 'This week' },
  { value: 'all', label: 'All time' },
] as const;

const FOOTERS: Record<Board, string> = {
  week: 'Only challenges with money on them count.',
  all: 'Only challenges with money on them count.',
  streak: 'Only challenges with money on them count. Kept days in a row on one running challenge; today doesn’t break it while it’s still open.',
  badges: `Only challenges with money on them count. Badges earned, out of ${BADGES.length}.`,
};

/** The word under each number. */
const UNIT: Record<Board, string> = { week: 'days kept', all: 'days kept', streak: 'in a row', badges: 'badges' };

/** The board, given the Friends tab's friends; until there's one, an invitation to add some (and share your profile). */
export function Leaderboard({ friends, onShare }: { friends: FriendRow[]; onShare: () => void }) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('days');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['value']>('week');
  const { people, failed, reload } = useLeaderboard(friends);
  const board: Board = kind === 'days' ? period : kind;
  const hasFriends = friends.some((f) => f.status === 'accepted');
  const rows = hasFriends && people ? boardRows(people, board, new Date()) : [];
  const me = rows.find((r) => r.me);

  return (
    <View style={styles.section}>
      <View style={styles.card}>
        <Text style={styles.title} accessibilityRole="header">
          Leaderboard
        </Text>
        <Segmented options={KINDS} value={kind} onChange={setKind} label="Leaderboard" />
        {!hasFriends ? (
          <View style={styles.empty}>
            <DayStamp kind="kept" color={colors.stamp} size={80} />
            <Text style={styles.emptyText}>Add friends to see how you stack up.</Text>
            <Button title="Share my profile" onPress={onShare} compact />
            {/* Where the rows will be. */}
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.ghost} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={styles.ghostDot} />
                <View style={styles.ghostLine} />
              </View>
            ))}
          </View>
        ) : failed ? (
          <Button title="Couldn’t load the leaderboard. Try again" onPress={reload} variant="secondary" />
        ) : (
          <>
            {kind === 'days' && (
              <View style={styles.period}>
                <Segmented options={PERIODS} value={period} onChange={setPeriod} label="Days kept over" />
              </View>
            )}
            {board === 'week' && <Text style={styles.since}>Since Monday</Text>}
            {board === 'week' && me && (
              <View style={styles.summary} accessible accessibilityLabel={`${me.value} days kept this week. ${boardSummary(rows)}`}>
                <Text style={styles.summaryNumber}>{me.value}</Text>
                <DayStamp kind="kept" color={colors.stamp} size={32} />
                <View style={styles.summaryText}>
                  <Text style={styles.summaryTitle}>days kept this week</Text>
                  <Text style={styles.caption}>{boardSummary(rows)}</Text>
                </View>
              </View>
            )}
            {people === null ? (
              <Text style={styles.caption}>Loading…</Text>
            ) : (
              rows.map((r) => (
                <Pressable
                  key={r.id}
                  style={({ pressed }) => [styles.row, r.me && styles.meRow, pressed && styles.pressed]}
                  onPress={() => (r.me ? router.push('/profile') : router.push({ pathname: '/friend/[id]', params: { id: r.id } }))}
                  accessibilityRole="button"
                  accessibilityLabel={`Place ${r.rank}, ${r.me ? 'you' : r.username}, ${valueText(board, r.value)}`}
                >
                  <Text style={styles.rank}>{r.rank}</Text>
                  <Avatar path={r.avatarPath} username={r.username} size={40} />
                  <View style={styles.name}>
                    <Text style={styles.username} numberOfLines={1}>
                      {r.me ? 'You' : `@${r.username}`}
                    </Text>
                    {r.me && <Text style={styles.caption}>@{r.username}</Text>}
                  </View>
                  {board === 'badges' ? (
                    <SymbolView name={{ ios: 'seal', android: 'verified' }} size={ICON.row} tintColor={colors.stamp} />
                  ) : (
                    <DayStamp kind="kept" color={colors.stamp} size={26} />
                  )}
                  <View style={styles.value}>
                    <Text style={styles.number}>{r.value}</Text>
                    <Text style={styles.unit}>{UNIT[board]}</Text>
                  </View>
                </Pressable>
              ))
            )}
            {kind === 'badges' && (
              <Pressable
                style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}
                onPress={() => router.push('/badges')}
                accessibilityRole="button"
              >
                <Text style={styles.seeAllText}>See your badges</Text>
                <Chevron />
              </Pressable>
            )}
          </>
        )}
      </View>
      <Text style={styles.footer}>{FOOTERS[board]}</Text>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    section: { gap: SPACE.sm },
    card: { backgroundColor: c.card, borderRadius: RADIUS.tile, borderCurve: 'continuous', padding: SPACE.lg, gap: SPACE.md, boxShadow: c.tileShadow || undefined },
    title: { ...TYPE.title, color: c.text },
    period: { width: '64%' },
    since: { ...TEXT.caption, color: c.secondaryText, marginTop: -SPACE.xs },
    summary: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, padding: SPACE.md, borderRadius: RADIUS.card, borderWidth: 1, borderColor: c.separator },
    summaryNumber: { ...TYPE.hero, color: c.text },
    summaryText: { flex: 1, gap: SPACE.xxs },
    summaryTitle: { ...TEXT.row, fontWeight: '600', color: c.text },
    caption: { ...TEXT.caption, color: c.secondaryText },
    row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.card },
    meRow: { backgroundColor: c.selected },
    pressed: { opacity: 0.7 },
    rank: { ...TEXT.row, color: c.secondaryText, fontVariant: ['tabular-nums'], minWidth: 18, textAlign: 'center' },
    name: { flex: 1 },
    username: { ...TEXT.row, fontWeight: '600', color: c.text },
    value: { alignItems: 'flex-end', minWidth: 52 },
    number: { ...TYPE.heading, fontFamily: FONTS.heavy, color: c.text, fontVariant: ['tabular-nums'] },
    unit: { ...TEXT.caption, color: c.secondaryText },
    seeAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator, paddingTop: SPACE.sm },
    seeAllText: { ...TEXT.row, color: c.text },
    empty: { alignItems: 'center', gap: SPACE.md, paddingTop: SPACE.md },
    emptyText: { ...TEXT.row, color: c.secondaryText, textAlign: 'center' },
    ghost: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.card, backgroundColor: c.background },
    ghostDot: { width: 36, height: 36, borderRadius: RADIUS.pill, backgroundColor: c.track },
    ghostLine: { flex: 1, height: 10, borderRadius: RADIUS.pill, backgroundColor: c.track },
    footer: { ...TEXT.caption, color: c.secondaryText, marginHorizontal: SPACE.sm },
  });
