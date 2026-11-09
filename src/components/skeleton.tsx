// What a screen shows while its data loads (owner, 2026-10-02, redesign pass): placeholder tiles in
// the bento's own shapes, gently pulsing, instead of a spinner, so the screen doesn't jump when the
// numbers arrive. Under Reduce Motion they hold still. VoiceOver reads it as "Loading".

import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { RADIUS, SPACE, useStyles, type Colors } from '@/lib/theme';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/** `hero` leads with Home's shape (a big tile beside two small ones); without it, just cards. */
export function Skeleton({ hero = true }: { hero?: boolean }) {
  const styles = useStyles(makeStyles);
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduced) return pulse.setValue(0.7);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, pulse]);

  return (
    <Animated.View style={[styles.wrap, { opacity: pulse }]} accessible accessibilityRole="progressbar" accessibilityLabel="Loading">
      {hero && (
        <View style={styles.bento}>
          <View style={[styles.block, styles.hero]} />
          <View style={styles.side}>
            <View style={[styles.block, styles.small]} />
            <View style={[styles.block, styles.small]} />
          </View>
        </View>
      )}
      {Array.from({ length: 2 }, (_, i) => (
        <View key={i} style={[styles.block, styles.card]} />
      ))}
    </Animated.View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    wrap: { gap: SPACE.md },
    bento: { flexDirection: 'row', gap: SPACE.md },
    side: { flex: 1, gap: SPACE.md },
    block: { backgroundColor: c.track, borderRadius: RADIUS.tile, borderCurve: 'continuous' },
    hero: { flex: 1.35, height: 236 },
    small: { flex: 1 },
    card: { height: 132 },
  });
