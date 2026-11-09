// A small (i) beside a heading or a number: tapping it explains the words in a sentence or two, so the page
// itself stays short (owner, 2026-11-03: Kept credits had a paragraph under it). The icon is small, so
// the tap area reaches out to the 44-point minimum.

import { SymbolView } from 'expo-symbols';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { ICON, useColors } from '@/lib/theme';

const REACH = (44 - ICON.inline) / 2;

export function InfoButton({ label, onPress, style }: { label: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} hitSlop={REACH} accessibilityRole="button" accessibilityLabel={label} style={style}>
      <SymbolView name={{ ios: 'info.circle', android: 'info' }} size={ICON.inline} tintColor={colors.secondaryText} />
    </Pressable>
  );
}
