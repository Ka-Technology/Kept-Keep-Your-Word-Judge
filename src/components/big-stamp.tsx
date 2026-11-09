// Kept's signature moment (owner, 2026-10-02): a big rubber stamp, set down a little crooked. Since
// decision 93 it's the day box: the real stamp Higgsfield made (docs/brand/stamps/, copied to
// assets/images/), one day's box with a K, tinted green; a missed day is the same box with an X, in
// seal red (DayStamp, also on the stamp card's cells and the finish card). BigStamp marks a day
// done: Home and Check in once everything's in, a check-in just sent, a tracker day marked done, a
// finished challenge's results. With `animate`, it drops in (from 1.4× and clear, settling at its
// tilt in about 220 ms) with a success tap, as when it's just happened; under Reduce Motion it just
// appears, still with the tap. The same stamp-down (useStampDown) sets a day approved since the
// last visit into Home's strip (T98). Decorative: the words beside it say what happened.

import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, type DimensionValue } from 'react-native';

import { SPACE } from '@/lib/theme';
import { useReducedMotion } from '@/lib/use-reduced-motion';

// Ink masks: only their opacity matters, so tintColor colors them. Each is already set down at −8°.
const STAMPS = { kept: require('@/assets/images/stamp-k.png'), missed: require('@/assets/images/stamp-x.png') };

// The X's picture leaves a wider margin than the K's: its ink spans 535×555 of the 640 px canvas to
// the K's 599×635, so it's drawn 1.13× to come out the same size (owner, 2026-10-18, T149).
// ponytail: a scale, not a recropped image; recrop stamp-x.png to the K's margin if it's ever redrawn.
const X_MATCH_K = [{ scale: 1.13 }];

/** The day box: a K for a kept day, an X for a missed one, the same size. Shape tells them apart, not only `color`. */
export function DayStamp({ kind, color, size }: { kind: 'kept' | 'missed'; color: string; size: DimensionValue }) {
  return (
    <Image
      source={STAMPS[kind]}
      tintColor={color}
      style={{ width: size, height: size, transform: kind === 'missed' ? X_MATCH_K : undefined }}
      contentFit="contain"
      accessible={false}
    />
  );
}

/**
 * The stamp-down: with `animate`, from 1.4× and clear to its place in about 220 ms, landing on the
 * picture's own −8° from −2°; at once under Reduce Motion. Without it, the stamp is simply there.
 */
export function useStampDown(animate: boolean) {
  const reduced = useReducedMotion();
  const [drop] = useState(() => new Animated.Value(animate ? 0 : 1));
  useEffect(() => {
    if (!animate) return;
    if (reduced) drop.setValue(1);
    else Animated.spring(drop, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6 }).start();
  }, [animate, reduced, drop]);
  return {
    opacity: drop,
    transform: [{ scale: drop.interpolate({ inputRange: [0, 1], outputRange: [1.4, 1] }) }, { rotate: drop.interpolate({ inputRange: [0, 1], outputRange: ['6deg', '0deg'] }) }],
  };
}

export function BigStamp({ color, animate = false, size = 72, centered = false }: { color: string; animate?: boolean; size?: number; centered?: boolean }) {
  const down = useStampDown(animate);

  // The success tap comes with the stamp, Reduce Motion or not.
  useEffect(() => {
    if (animate) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [animate]);

  return (
    <Animated.View style={[styles.stamp, centered && styles.centered, down]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <DayStamp kind="kept" color={color} size={size} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stamp: { alignSelf: 'flex-start', marginVertical: SPACE.xs },
  centered: { alignSelf: 'center' },
});
