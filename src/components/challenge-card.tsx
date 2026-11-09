// A running challenge as a card (owner interview, 2026-09-27; A3, T100): the habit's icon and name,
// its last seven days as stamps over their weekdays, and who's backing it. With `status` (the
// Challenges tab, T104), where it stands under the name ("Day 12 of 28, 2 of 2 shields left") and the
// days' numbers under the stamps. The whole card opens the challenge.

import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { statusLine } from '@/components/challenge-rows';
import { HabitIcon } from '@/components/habit-icon';
import { StampStrip } from '@/components/stamp-card';
import { Tile } from '@/components/tile';
import type { ChallengeSummary } from '@/lib/challenges';
import { FONTS, SPACE, TEXT, TYPE, useStyles, type Colors } from '@/lib/theme';

export function ChallengeCard({ challenge, backing, status = false }: { challenge: ChallengeSummary; backing?: string; status?: boolean }) {
  const styles = useStyles(makeStyles);
  const { daysCompleted, daysRequired } = challenge;
  return (
    <Tile
      onPress={() => router.push({ pathname: '/challenge/[id]', params: { id: challenge.id } })}
      accessibilityLabel={[challenge.title, statusLine(challenge), `${daysCompleted} of ${daysRequired} days kept`, backing].filter(Boolean).join('. ')}
      style={styles.card}
    >
      <View style={styles.head}>
        <HabitIcon habitId={challenge.habitId} look="bare" />
        <View style={styles.headText}>
          <Text style={styles.title} numberOfLines={2}>
            {challenge.title}
          </Text>
          {status && <Text style={styles.status}>{statusLine(challenge)}</Text>}
        </View>
      </View>
      <StampStrip challenge={challenge} numbers={status} />
      {backing && <Text style={styles.backing}>{backing}</Text>}
    </Tile>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: { gap: SPACE.lg },
    head: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    headText: { flex: 1, gap: SPACE.xxs },
    title: { ...TYPE.heading, fontFamily: FONTS.heavy, color: c.text },
    status: { ...TEXT.note, color: c.secondaryText },
    backing: { ...TEXT.caption, color: c.link, fontWeight: '600' },
  });
