// The soft change between light and dark (Settings → Appearance). Just before the switch, a still of
// the screen (react-native-view-shot) covers the app; the colors change underneath it, then the still
// fades away, so every color crossfades at once instead of each view popping on its own frame
// (iOS's dynamic colors and the JS styles otherwise change a beat apart). Reduce Motion and the
// web switch straight away. Mounted once, over everything, by the root layout.

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, useColorScheme } from 'react-native';
import { captureScreen, releaseCapture } from 'react-native-view-shot';

import { setAppearanceCover } from '@/lib/appearance';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/** How long the old colors take to fade out. */
const FADE_MS = 350;

/** The longest the still waits for the new colors before fading anyway (a choice that changes nothing). */
const WAIT_MS = 300;

export function ThemeFade() {
  const scheme = useColorScheme();
  const reduced = useReducedMotion();
  const [still, setStill] = useState<string | null>(null);
  const [opacity] = useState(() => new Animated.Value(1));
  const painted = useRef<() => void>(undefined);
  const fade = useRef<() => void>(undefined);

  useEffect(() => {
    if (reduced || Platform.OS === 'web') return;
    setAppearanceCover(async () => {
      const uri = await captureScreen({ format: 'jpg', quality: 0.9 });
      opacity.setValue(1);
      await new Promise<void>((resolve) => {
        painted.current = resolve;
        setStill(uri);
      });
      // Revealed: fade once the new colors have rendered, or after WAIT_MS if nothing changed.
      return () => {
        const timer = setTimeout(() => fade.current?.(), WAIT_MS);
        fade.current = () => {
          fade.current = undefined;
          clearTimeout(timer);
          Animated.timing(opacity, { toValue: 0, duration: FADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
            // Cut short by a second switch, whose own still is already showing.
            if (finished) setStill(null);
            releaseCapture(uri);
          });
        };
      };
    });
    return () => setAppearanceCover(null);
  }, [reduced, opacity]);

  // The new colors are on screen a frame after the scheme changes.
  useEffect(() => {
    requestAnimationFrame(() => fade.current?.());
  }, [scheme]);

  if (!still) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity, pointerEvents: 'none' }]} accessible={false}>
      <Image
        source={{ uri: still }}
        style={StyleSheet.absoluteFill}
        onLoad={() => requestAnimationFrame(() => painted.current?.())}
        onError={() => painted.current?.()}
      />
    </Animated.View>
  );
}
