// A card you can swipe to the left, a little like Hinge's match list (owner, 2026-10-29): "Learn more" shows behind
// it as it moves, and letting go far or fast enough (swipe-actions.ts) runs `onLearn`, then the card springs back.
// Only a swipe to the left counts: to the right is iOS's back gesture. Only a clearly sideways drag takes over, so
// the screen still scrolls up and down. Under Reduce Motion the card doesn't follow the finger, but the swipe
// still works. VoiceOver and Switch Control get "Learn more" in the card's actions menu.

import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';

import { swipesToLearn } from '@/lib/swipe-actions';
import { isSideways } from '@/lib/tab-swipe';
import { ICON, RADIUS, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/** How closely the card follows the finger, and the most it travels (a share of its width, so the panel stays visible). */
const DRAG = 0.8;
const MAX_SHARE = 0.45;

export function SwipeRow({ onLearn, canLearn, children }: { onLearn: () => void; canLearn: boolean; children: ReactNode }) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const reduced = useReducedMotion();
  const [x] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);

  const responder = useMemo(() => {
    const back = () => Animated.spring(x, { toValue: 0, useNativeDriver: true, speed: 28, bounciness: 0 }).start();
    return PanResponder.create({
      // Only a sideways drag to the left, and only on a charity that has a page; anything else stays with the screen.
      onMoveShouldSetPanResponderCapture: (_e, g) => canLearn && g.dx < 0 && isSideways(g.dx, g.dy),
      onPanResponderMove: (_e, g) => {
        if (!reduced) x.setValue(Math.max(-width * MAX_SHARE, Math.min(0, g.dx * DRAG)));
      },
      onPanResponderRelease: (_e, g) => {
        back();
        if (!swipesToLearn(g.dx, g.dy, g.vx)) return;
        Haptics.selectionAsync();
        onLearn();
      },
      onPanResponderTerminate: back,
    });
  }, [canLearn, onLearn, reduced, width, x]);

  // The panel behind shows as the card moves away from it.
  const panelOpacity = x.interpolate({ inputRange: [-24, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityActions={canLearn ? [{ name: 'learn', label: 'Learn more' }] : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'learn') onLearn();
      }}
    >
      {canLearn && (
        <Animated.View style={[styles.panel, { opacity: panelOpacity }]} pointerEvents="none">
          <Text style={[styles.panelText, { color: colors.onPrimary }]}>Learn more</Text>
          <SymbolView name={{ ios: 'info.circle', android: 'info' }} size={ICON.row} tintColor={colors.onPrimary} />
        </Animated.View>
      )}
      <Animated.View style={{ transform: [{ translateX: x }] }} {...responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    // The panel rounds its own corners, so the card's shadow isn't clipped.
    panel: {
      ...StyleSheet.absoluteFill,
      borderRadius: RADIUS.card,
      borderCurve: 'continuous',
      backgroundColor: c.primary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: SPACE.sm,
      paddingHorizontal: SPACE.xl,
    },
    panelText: { ...TEXT.row, fontWeight: '600' },
  });
