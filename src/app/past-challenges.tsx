// Past challenges: the user's ended ones (finished, not finished or cancelled), newest first. Each
// opens its detail and results. Opened from the Challenges tab, which shows only running ones. As in
// the A3 mockup since T137 (full-set/ui-flow-4-past.jpg): "Past challenges" large, each one a card with
// its icon, "28 of 28 days" and its K or X box, then where the stake went ("$25 back to you").

import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { DayStamp } from '@/components/big-stamp';
import { HabitIcon } from '@/components/habit-icon';
import { ListScreen } from '@/components/list';
import { LoadingScreen } from '@/components/step-screen';
import { PageTitle } from '@/components/tab-title';
import { Tile } from '@/components/tile';
import { pastMoney } from '@/lib/challenges';
import { ICON, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { useMyChallenges } from '@/lib/use-my-challenges';

export default function PastChallenges() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { challenges, failed, reload } = useMyChallenges();
  if (!challenges) return <LoadingScreen failed={failed} onRetry={reload} message="Couldn’t load your challenges. Check your connection and try again." />;

  const ended = challenges.filter((c) => c.state !== 'upcoming' && c.state !== 'active');
  return (
    <ListScreen>
      <PageTitle title="Past challenges" />
      {ended.length === 0 && <Text style={styles.empty}>No past challenges yet. Finished ones show here.</Text>}
      {ended.map((c) => {
        const { amount, line } = pastMoney(c);
        const outcome = c.state === 'finished' ? 'kept' : c.state === 'not_finished' ? 'missed' : null;
        const days = c.state === 'cancelled' ? 'Cancelled' : `${c.daysCompleted} of ${c.daysRequired} days`;
        return (
          <Tile
            key={c.id}
            style={styles.card}
            onPress={() => router.push({ pathname: '/challenge/[id]', params: { id: c.id } })}
            accessibilityLabel={`${c.title}, ${days}, ${c.state === 'finished' ? 'kept' : c.state === 'not_finished' ? 'not finished' : 'cancelled'}. ${amount} ${line}`}
          >
            <View style={styles.row}>
              <HabitIcon habitId={c.habitId} look="bare" />
              <View style={styles.text}>
                <Text style={styles.title}>{c.title}</Text>
                <Text style={styles.sub}>{days}</Text>
              </View>
              {outcome && <DayStamp kind={outcome} color={outcome === 'kept' ? colors.stamp : colors.error} size={52} />}
            </View>
            <View style={[styles.row, styles.money]}>
              <View style={styles.moneyIcon}>
                <SymbolView name={{ ios: 'dollarsign.circle', android: 'paid' }} size={ICON.hero} tintColor={colors.text} />
              </View>
              <View style={styles.text}>
                <Text style={styles.amount}>{amount}</Text>
                <Text style={styles.sub}>{line}</Text>
              </View>
            </View>
          </Tile>
        );
      })}
    </ListScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    empty: { ...TEXT.body, color: c.secondaryText, marginHorizontal: SPACE.xs },
    // The rows pad themselves; the tile only pads the sides.
    card: { paddingHorizontal: SPACE.lg, paddingVertical: 0, gap: 0 },
    row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.lg, paddingVertical: SPACE.lg },
    money: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator },
    moneyIcon: { width: 36, alignItems: 'center' },
    text: { flex: 1, gap: SPACE.xxs },
    title: { ...TYPE.title, color: c.text },
    sub: { ...TEXT.row, color: c.secondaryText },
    amount: { ...TYPE.stat, color: c.text },
  });
