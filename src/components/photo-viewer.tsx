// A profile photo shown large over a dimmed screen, like tapping a profile picture on Instagram
// (owner, 2026-10-03): the photo in a circle, as avatars show it (owner, 2026-10-18; it was a rounded square); pinch to zoom into any spot, like Instagram, but no
// scrolling around (owner, 2026-10-03; it eases back when the fingers lift); and a tap anywhere around
// it closes it. Your profile puts its change and remove buttons underneath; a
// friend's photo, or one in a friend request, opens bare.

import { Image } from 'expo-image';
import { useMemo, useState, type ReactNode } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';

import { Avatar } from '@/components/avatar';
import { avatarUrl } from '@/lib/avatar-storage';
import { pinchFocus, pinchScale } from '@/lib/pinch';
import { PHOTO_BACKDROP, RADIUS, SPACE, useStyles, type Colors } from '@/lib/theme';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/** The distance between two fingers. */
const spread = (e: GestureResponderEvent) => {
  const [a, b] = e.nativeEvent.touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
};

/** The photo's zoom: how far in, and the point it zooms toward, from the photo's center. */
type Zoom = { scale: Animated.Value; focus: Animated.ValueXY };

/**
 * Two fingers zoom into the spot between them, like Instagram: that spot stays put while the rest
 * grows around it. Moving the fingers changes only how far in, never where, and one finger does
 * nothing, so the photo can't be scrolled around. Letting go eases it back (at once under Reduce Motion).
 */
function pinchHandlers({ scale, focus }: Zoom, size: number, reduced: boolean) {
  // Whether a pinch is under way, the fingers' spread when it began (0 until they've spread), and the
  // zoom it began from (above 1 when it caught the photo easing back).
  let pinching = false;
  let start = 0;
  let base = 1;
  const twoFingers = (e: GestureResponderEvent) => e.nativeEvent.touches.length === 2;
  const reset = () => {
    pinching = false;
    start = 0;
    base = 1;
    if (reduced) scale.setValue(1);
    else Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
  };
  return PanResponder.create({
    onStartShouldSetPanResponder: twoFingers,
    onMoveShouldSetPanResponder: twoFingers,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (e) => {
      if (!twoFingers(e)) return;
      if (!pinching) {
        pinching = true;
        scale.stopAnimation((value) => {
          base = value;
        });
        // The spot between the fingers, in the photo's own points (it's at full size between pinches).
        const [a, b] = e.nativeEvent.touches;
        focus.setValue(pinchFocus({ x: a.locationX, y: a.locationY }, { x: b.locationX, y: b.locationY }, size));
      }
      if (!start) start = spread(e);
      scale.setValue(pinchScale(spread(e), start, base));
    },
    onPanResponderRelease: reset,
    onPanResponderTerminate: reset,
  }).panHandlers;
}

function usePinchZoom(size: number) {
  const reduced = useReducedMotion();
  const [zoom] = useState(() => {
    const scale = new Animated.Value(1);
    const focus = new Animated.ValueXY();
    // Scaling about the focus f: move by f × (1 − scale), then scale about the center.
    const shrink = Animated.subtract(new Animated.Value(1), scale);
    return {
      scale,
      focus,
      transform: [{ translateX: Animated.multiply(shrink, focus.x) }, { translateY: Animated.multiply(shrink, focus.y) }, { scale }],
    };
  });
  const handlers = useMemo(() => pinchHandlers(zoom, size, reduced), [zoom, size, reduced]);
  return { transform: zoom.transform, handlers };
}

export function PhotoViewer({
  path,
  username,
  visible,
  onClose,
  children,
}: {
  path: string;
  username: string;
  visible: boolean;
  onClose: () => void;
  /** Buttons shown under the photo, e.g. your profile's Take photo and Remove photo. */
  children?: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  // Photos are cropped square (avatar-storage.ts) for a circle, so the whole circle shows, as wide as fits.
  const size = Math.min(width, height, 600) - SPACE.lg * 2;
  const zoom = usePinchZoom(size);
  const square = { width: size, height: size };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.screen} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close photo" />
        <View style={[styles.photo, square, { borderRadius: size / 2 }]} {...zoom.handlers}>
          <Animated.View style={{ transform: zoom.transform }}>
            <Image source={{ uri: avatarUrl(path) }} style={square} contentFit="cover" accessibilityLabel={`${username}'s profile photo`} />
          </Animated.View>
        </View>
        {children && <View style={[styles.actions, { width: size }]}>{children}</View>}
      </View>
    </Modal>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.xl, backgroundColor: PHOTO_BACKDROP },
    // The zoom stays inside the photo's circle.
    photo: { overflow: 'hidden', backgroundColor: c.card },
    pressed: { opacity: 0.7 },
    actions: { gap: SPACE.md, padding: SPACE.lg, borderRadius: RADIUS.tile, borderCurve: 'continuous', backgroundColor: c.elevated },
  });

/** An Avatar that opens large when tapped: a friend's, or one in a friend request or Find. Without a photo it's just the initial. */
export function TappableAvatar({ path, username, size }: { path: string | null | undefined; username: string; size: number }) {
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  if (!path) return <Avatar path={path} username={username} size={size} />;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${username}'s profile photo. Opens it large`}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Avatar path={path} username={username} size={size} />
      </Pressable>
      <PhotoViewer path={path} username={username} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
