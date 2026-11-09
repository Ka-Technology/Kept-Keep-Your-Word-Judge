// The bento tile every screen is built from (owner, 2026-10-02; A3, decision 95): a rounded surface
// in one of three tones, never a solid color. `plain` (white by day, raised at night) for nearly
// every tile; `wash` (pale green) for "your turn"; `alert` (pale red) for a check-in that didn't
// pass and needs doing again. The text on each is ink and pencil; the color comes from what sits on
// it (the stamps, a ring, one green button). Screens lay tiles out in plain flex rows of mixed
// sizes. A tile with onPress is a button: it eases to 97% while pressed (no layout moves), or just
// dims under Reduce Motion. StatTile is the one number over its label that every summary row is made of.

import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { InfoButton } from '@/components/info-button';
import { amountAt } from '@/lib/challenges';
import { HERO_MAX_SCALE, ICON, RADIUS, SPACE, TEXT, TYPE, useColors, type Colors } from '@/lib/theme';
import { useReducedMotion } from '@/lib/use-reduced-motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A stat this many characters or fewer ("2", "$25", "86%") always fits a tile at full size. */
const SHORT_VALUE = 3;

export type TileTone = 'plain' | 'wash' | 'alert';

function surface(c: Colors, tone: TileTone): ViewStyle {
  switch (tone) {
    case 'wash':
      return { backgroundColor: c.selected };
    case 'alert':
      return { backgroundColor: c.alertWash };
    default:
      return { backgroundColor: c.card, boxShadow: c.tileShadow || undefined };
  }
}

type Props = {
  tone?: TileTone;
  onPress?: () => void;
  /** What VoiceOver reads for a pressable tile; a plain tile's text is read as it is. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Layout (flex, minHeight, alignment) and anything else; it applies to the tile itself, pressable or not. */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

export function Tile({ tone = 'plain', onPress, accessibilityLabel, accessibilityHint, style, children }: Props) {
  const c = useColors();
  const reduced = useReducedMotion();
  // 0 at rest, 1 while pressed.
  const [press] = useState(() => new Animated.Value(0));
  const box = [styles.tile, surface(c, tone), style];

  if (!onPress) return <View style={box}>{children}</View>;

  const to = (value: number) =>
    reduced ? press.setValue(value) : Animated.spring(press, { toValue: value, useNativeDriver: true, speed: 40, bounciness: 4 }).start();
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, reduced ? 1 : 0.97] });
  const opacity = press.interpolate({ inputRange: [0, 1], outputRange: [1, reduced ? 0.8 : 1] });
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => to(1)}
      onPressOut={() => to(0)}
      style={[box, { opacity, transform: [{ scale }] }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * One number over its label ("12 days kept", "$35 staked now"), read by VoiceOver as one phrase
 * unless `accessibilityLabel` says it better. The number is ink, or green for what was kept (days
 * kept, money back to you). `big` sets it at the hero size, for the lead tile of a row; `style`
 * sizes the tile in its row. `countUp` counts an amount up from $0 as it appears (T98). `icon`
 * puts an outline icon in the tile's top corner, with the number and label at the bottom (A3, T100).
 * `onInfo` puts an (i) in the top right corner, over nothing else, so no word moves; tapping it should explain the label.
 */
export function StatTile({
  value,
  label,
  green = false,
  big = false,
  countUp = false,
  icon,
  onInfo,
  accessibilityLabel,
  style,
}: {
  value: string;
  label: string;
  green?: boolean;
  big?: boolean;
  countUp?: boolean;
  icon?: SymbolViewProps['name'];
  onInfo?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const shown = useCountUp(value, countUp);
  return (
    <Tile style={[styles.stat, icon && styles.withIcon, style]}>
      {icon && <SymbolView name={icon} size={ICON.hero} tintColor={c.text} />}
      {onInfo && <InfoButton label={`About ${label}`} onPress={onInfo} style={styles.info} />}
      {/* VoiceOver reads the whole amount, never a number on its way up. */}
      <View style={styles.text} accessible accessibilityLabel={accessibilityLabel ?? `${value} ${label}`}>
        {/* Only a long amount ("$1,250") may shrink to fit: iOS's shrink-to-fit made a one-digit count
            like Home's shields smaller than the numbers beside it (T156). Three characters always fit. */}
        <Text
          style={[big ? TYPE.hero : TYPE.stat, styles.centered, { color: green ? c.stamp : c.text }]}
          adjustsFontSizeToFit={shown.length > SHORT_VALUE}
          minimumFontScale={0.5}
          numberOfLines={1}
          maxFontSizeMultiplier={HERO_MAX_SCALE}
        >
          {shown}
        </Text>
        <Text style={[icon ? TEXT.note : TEXT.caption, styles.centered, { color: c.secondaryText }]}>{label}</Text>
      </View>
    </Tile>
  );
}

/** `value` counting up from $0 over about 700 ms when `run`, as the big stamp lands; just `value` under Reduce Motion. */
function useCountUp(value: string, run: boolean): string {
  const reduced = useReducedMotion();
  const animate = run && !reduced;
  const [shown, setShown] = useState(() => (animate ? amountAt(value, 0) : value));
  useEffect(() => {
    if (!animate) return;
    const progress = new Animated.Value(0);
    const listener = progress.addListener(({ value: share }) => setShown(amountAt(value, share)));
    const timing = Animated.timing(progress, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    timing.start();
    return () => {
      timing.stop();
      progress.removeListener(listener);
    };
  }, [value, animate]);
  return animate ? shown : value;
}

const styles = StyleSheet.create({
  tile: { borderRadius: RADIUS.tile, borderCurve: 'continuous', padding: SPACE.lg, gap: SPACE.sm },
  // Every stat centered in its tile, its icon above it (owner, 2026-10-18, T148; it sat at the bottom left).
  stat: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  withIcon: { minHeight: 140, gap: SPACE.md },
  info: { position: 'absolute', top: SPACE.sm, right: SPACE.sm },
  centered: { textAlign: 'center' },
  text: { alignSelf: 'stretch' },
});
