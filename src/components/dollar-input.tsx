// A whole-dollar amount box with a $ in front: the stake (T16), a pledge (T31) and an extra gift
// (T32). Number pad with iOS's own Done above it (returnKeyType, T214). `big` makes
// it the screen's one big number on a tile (owner, 2026-10-02; A3, T111: set at the left, the $ in
// ink, with `caption` under it, "Up to $25 on your first challenge").

import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Tile } from '@/components/tile';
import { bigInputStyle, HERO_MAX_SCALE, inputStyle, PLACEHOLDER_COLOR, SPACE, TEXT, TYPE, useStyles, type Colors } from '@/lib/theme';

/** Up to three digits ($999), which covers every limit Kept has. */
export function DollarInput({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  big = false,
  caption = 'Tap to change',
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  big?: boolean;
  /** The line under a big amount. */
  caption?: string;
}) {
  const styles = useStyles(makeStyles);
  const input = (
    <TextInput
      style={big ? styles.bigInput : styles.input}
      placeholder={placeholder}
      placeholderTextColor={PLACEHOLDER_COLOR}
      accessibilityLabel={accessibilityLabel}
      value={value}
      onChangeText={onChangeText}
      keyboardType="number-pad"
      returnKeyType="done"
      maxLength={3}
      maxFontSizeMultiplier={big ? HERO_MAX_SCALE : undefined}
    />
  );
  if (!big) {
    return (
      <View style={styles.row}>
        <Text style={styles.dollar}>$</Text>
        {input}
      </View>
    );
  }
  return (
    <Tile style={styles.bigTile}>
      <View style={styles.bigRow}>
        <Text style={styles.bigDollar} maxFontSizeMultiplier={HERO_MAX_SCALE}>
          $
        </Text>
        {input}
      </View>
      <Text style={styles.caption}>{caption}</Text>
    </Tile>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
    bigRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xxs },
    dollar: { ...TYPE.number, color: c.text },
    input: { ...inputStyle(c), fontFamily: TYPE.number.fontFamily, fontSize: TYPE.number.fontSize, width: 110, textAlign: 'center' },
    bigTile: { paddingVertical: SPACE.xl, paddingHorizontal: SPACE.xl },
    bigDollar: { ...TYPE.hero, color: c.text },
    bigInput: { ...bigInputStyle(c), minWidth: 90 },
    caption: { ...TEXT.row, color: c.secondaryText },
  });
