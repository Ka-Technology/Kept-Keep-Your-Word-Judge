// Swipe sideways between the tabs (owner, 2026-10-02). Wraps a tab screen: a clearly sideways drag
// (never the screen's own up-and-down scrolling) moves the screen with the finger; let go far or
// fast enough and the next tab (swiping left) or the previous one (right) opens at once and slides
// in from that side. At either end, or a short drag, it springs back. Kept quick on purpose (owner,
// 2026-10-02: it felt slow): no exit animation, a short slide in. Under Reduce Motion the tab just
// changes. The tab bar stays the way to switch with a tap or VoiceOver.

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, useWindowDimensions } from 'react-native';

import { isSideways, neighborTab, swipeFrom, TAB_HREF, type TabName } from '@/lib/tab-swipe';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/** How closely the screen follows the finger (1 = exactly). A little under 1 reads as being pulled. */
const DRAG = 0.8;
/** The arriving tab's slide: a short distance (a share of the screen's width), fast, easing out. */
const ENTER_SHARE = 0.12;
const ENTER_MS = 150;

// The side the next tab should slide in from, set by the tab being swiped away and read by the one
// it opens. A tap on the tab bar leaves it null, so that switch stays the system's own.
let arriving: 'next' | 'previous' | null = null;

/** Hands the swipe's direction to the tab it opens. */
function setArriving(direction: 'next' | 'previous') {
  arriving = direction;
}

/** The direction a tab was swiped in from, once; null after a tab-bar tap. */
function takeArriving() {
  const direction = arriving;
  arriving = null;
  return direction;
}

export function TabSwipe({ tab, children }: { tab: TabName; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [x] = useState(() => new Animated.Value(0));
  const enter = width * ENTER_SHARE;

  // Arriving by a swipe: slide in from the side the finger came from.
  useFocusEffect(
    useCallback(() => {
      const from = takeArriving();
      if (!from || reduced) {
        x.setValue(0);
        return;
      }
      x.setValue(from === 'next' ? enter : -enter);
      Animated.timing(x, { toValue: 0, duration: ENTER_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [reduced, enter, x]),
  );

  const responder = useMemo(() => {
    const back = () => Animated.spring(x, { toValue: 0, useNativeDriver: true, speed: 28, bounciness: 0 }).start();
    return PanResponder.create({
      // Only a sideways drag toward a tab that exists; anything else stays with the scroll view.
      onMoveShouldSetPanResponderCapture: (_e, g) => isSideways(g.dx, g.dy) && neighborTab(tab, g.dx < 0 ? 'next' : 'previous') !== null,
      onPanResponderMove: (_e, g) => {
        if (!reduced) x.setValue(g.dx * DRAG);
      },
      onPanResponderRelease: (_e, g) => {
        const direction = swipeFrom(g.dx, g.dy, g.vx);
        const to = direction && neighborTab(tab, direction);
        if (!direction || !to) return back();
        // Open the next tab straight away; this one is hidden now, so put it back for next time.
        setArriving(direction);
        router.navigate(TAB_HREF[to]);
        x.setValue(0);
      },
      onPanResponderTerminate: back,
    });
  }, [tab, reduced, x]);

  // Fades a little as it's dragged, so the pull reads as leaving.
  const opacity = x.interpolate({ inputRange: [-width / 2, 0, width / 2], outputRange: [0.6, 1, 0.6], extrapolate: 'clamp' });
  return (
    <Animated.View style={[styles.fill, { opacity, transform: [{ translateX: x }] }]} {...responder.panHandlers}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
