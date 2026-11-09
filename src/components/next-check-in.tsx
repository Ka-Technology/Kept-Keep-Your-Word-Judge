// The floating "next check-in" pill above the tab bar (iOS 26's bottom accessory, owner 2026-10-02),
// like Apple Music's mini player: while a check-in is still due today it shows the soonest one,
// with its real time left, and a tap opens it (Check in when several are due). A check-in to redo
// (a friend or Kept's AI asked for it again) leads, in red (owner, 2026-10-02). Tab layouts render
// two copies at once (regular and inline), so everything it shows comes in through props.

import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HabitIcon } from '@/components/habit-icon';
import { Chevron } from '@/components/list';
import { SPACE, TEXT, TYPE, useStyles, type Colors } from '@/lib/theme';

export type NextDue = { challengeId: string; habitId: string; title: string; left: string; count: number; redo: boolean };

export function NextCheckIn({ next }: { next: NextDue }) {
  const styles = useStyles(makeStyles);
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const open = () =>
    next.count === 1
      ? router.push({ pathname: '/check-in/[challengeId]', params: next.redo ? { challengeId: next.challengeId } : { challengeId: next.challengeId, start: '1' } })
      : router.navigate('/check-in');
  const action = next.redo ? 'Redo' : 'Check in';
  const left = next.redo ? `Do it again · ${next.left}` : next.left;
  const label = next.count === 1 ? `${action}: ${next.title}, ${left}` : `${next.count} check-ins due. Next: ${next.title}, ${left}`;

  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={open} accessibilityRole="button" accessibilityLabel={label}>
      <HabitIcon habitId={next.habitId} />
      {placement === 'inline' ? (
        <Text style={styles.left}>{left}</Text>
      ) : (
        <>
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>
              {next.count > 1 ? `${next.title} +${next.count - 1}` : next.title}
            </Text>
            <Text style={styles.left}>{left}</Text>
          </View>
          <Text style={[styles.action, next.redo && styles.redo]}>{action}</Text>
          <Chevron />
        </>
      )}
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: SPACE.md },
    pressed: { opacity: 0.6 },
    text: { flex: 1 },
    title: { ...TYPE.section, color: c.text },
    left: { ...TEXT.caption, color: c.error, fontWeight: '600' },
    action: { ...TEXT.note, color: c.link, fontWeight: '600' },
    redo: { color: c.error },
  });
