// A progress ring, like Apple Fitness's: a track circle and an arc for the share done, starting at
// the top. It fills from empty when it first appears (600 ms), or shows its value at once under
// Reduce Motion. Whatever sits inside (a number, a label) is passed as children. VoiceOver reads
// the ring as one phrase, e.g. "12 of 28 days kept".

import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useReducedMotion } from '@/lib/use-reduced-motion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Props = {
  /** The share done, 0 to 1. */
  value: number;
  size: number;
  /** The arc's width. */
  stroke?: number;
  color: string;
  trackColor: string;
  accessibilityLabel: string;
  children?: ReactNode;
};

export function ProgressRing({ value, size, stroke = 10, color, trackColor, accessibilityLabel, children }: Props) {
  const reduced = useReducedMotion();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const share = Math.min(1, Math.max(0, value));
  const [progress] = useState(() => new Animated.Value(reduced ? share : 0));

  useEffect(() => {
    if (reduced) {
      progress.setValue(share);
      return;
    }
    // strokeDashoffset isn't a native-driver prop, so this runs on the JS thread: one short fill.
    Animated.timing(progress, { toValue: share, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [share, reduced, progress]);

  const offset = progress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] });

  return (
    <View style={{ width: size, height: size }} accessible accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel}>
      <Svg width={size} height={size} style={styles.svg}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
        />
      </Svg>
      <View style={styles.center} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Start the arc at 12 o'clock.
  svg: { transform: [{ rotate: '-90deg' }] },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
