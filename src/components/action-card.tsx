// A card that asks for one thing, the whole card being the button (Check in tab, owner interview
// 2026-09-27; as in the A3 mockup since T105, full-set/sheet-tab.jpg): a small label ("Due today",
// "Not approved"), the habit's name, a line ("Due by 11:59 PM, 4h 12m left"), and the action on the
// right, a green Check in pill or, for a check-in that didn't pass (to do again or appeal), a red
// edge and the action as a link. The words carry the urgency too, so it doesn't rely on color alone.

import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Tile } from '@/components/tile';
import { RADIUS, SPACE, TEXT, TYPE, useStyles, type Colors } from '@/lib/theme';

export function ActionCard({
  tone,
  label,
  title,
  line,
  action,
  onPress,
}: {
  tone: 'due' | 'failed';
  /** The small word over the title: "Due today", "Do it again", "Not approved". */
  label: string;
  title: string;
  /** The deadline or what went wrong, e.g. "Due by 11:59 PM, 4h 12m left". */
  line: string;
  /** The action's word: "Check in", "Redo", "Appeal". */
  action: string;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  const failed = tone === 'failed';
  return (
    <Tile onPress={onPress} style={[styles.card, failed && styles.failed]} accessibilityLabel={`${label}. ${title}. ${line}. ${action}.`}>
      <View style={styles.text}>
        <Text style={[styles.label, failed && styles.red]}>{label}</Text>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.line, failed && styles.red]}>{line}</Text>
        {failed && <Text style={styles.link}>{action}</Text>}
      </View>
      {!failed && <Button title={action} onPress={onPress} compact />}
    </Tile>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, padding: SPACE.xl },
    // A red edge down the left for a check-in that didn't pass.
    failed: { borderLeftWidth: 5, borderLeftColor: c.error, borderTopLeftRadius: RADIUS.small, borderBottomLeftRadius: RADIUS.small },
    text: { flex: 1, gap: SPACE.xxs },
    label: { ...TEXT.note, color: c.secondaryText },
    red: { color: c.error },
    title: { ...TYPE.title, color: c.text },
    line: { ...TEXT.note, color: c.secondaryText },
    link: { ...TEXT.row, color: c.text, fontWeight: '600', marginTop: SPACE.xs },
  });
