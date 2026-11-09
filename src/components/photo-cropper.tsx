// The profile photo's crop step (owner, 2026-10-18, T153), after choosing or taking a photo: the photo
// under a circle the size the avatar shows, which the user drags to place and pinches to zoom (or taps
// − and + for, which VoiceOver can reach), then Save. The parts outside the circle stay visible, dimmed,
// so it's clear what's left out. The maths is avatar.ts's clampCrop() and cropRect(), and pinch.ts's
// pinchScale(), all tested; the caller crops with cropRect() and uploads. Shown in a Modal: the caller
// renders it inside the photo viewer when that's open, since a Modal presents from the screen that holds it.
// Smooth (T154): a move only sets animated values on the photo's transform, the way the photo viewer
// pinches, so nothing re-renders or re-lays out while the fingers move; − and + glide.
// A Modal is its own window, so it gets its own SafeAreaProvider: without one the insets could read as none,
// and Cancel sat up on the status bar's clock (T211, Santosh's review).

import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Animated, Easing, Modal, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View, type NativeTouchEvent } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { clampCrop, type CropView } from '@/lib/avatar';
import type { ChosenPhoto } from '@/lib/avatar-storage';
import { pinchScale } from '@/lib/pinch';
import { ICON, RADIUS, SPACE, TEXT, TYPE, WHITE } from '@/lib/theme';
import { useReducedMotion } from '@/lib/use-reduced-motion';

const START: CropView = { zoom: 1, x: 0, y: 0 };
/** How much one tap on − or + zooms. */
const STEP = 1.25;
/**
 * The photo is laid out this many times larger than it shows at zoom 1 and scaled down, so zooming in
 * scales it down less instead of blowing up a small picture: it stays sharp to 2×, then softens a little.
 */
const SHARP = 2;

/** The distance between the first two fingers, or 0 with fewer. */
function spread(touches: readonly NativeTouchEvent[]): number {
  return touches.length < 2 ? 0 : Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
}

/** Zooms about the circle's center: the point under it stays there. */
function zoomTo(view: CropView, zoom: number): CropView {
  const ratio = zoom / view.zoom;
  return { zoom, x: view.x * ratio, y: view.y * ratio };
}

type Motion = { x: Animated.Value; y: Animated.Value; zoom: Animated.Value };

/**
 * The drag and pinch for one photo in a circle `side` points across. It keeps the latest view and where
 * the current gesture began (the view then, the fingers' spread when pinching, the move so far), and
 * moves the photo by setting `motion`'s values: one finger drags, two pinch and drag together. Outside
 * the component, since its handlers only run on touches.
 */
function cropGesture(photo: ChosenPhoto, side: number, motion: Motion, reduced: boolean) {
  let now = START;
  let leg = { from: START, spread: 0, dx: 0, dy: 0 };
  const show = (next: CropView, glide = false) => {
    now = clampCrop(photo, side, next);
    if (glide && !reduced) {
      const to = (value: Animated.Value, toValue: number) =>
        Animated.timing(value, { toValue, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true });
      Animated.parallel([to(motion.x, now.x), to(motion.y, now.y), to(motion.zoom, now.zoom)]).start();
    } else {
      motion.x.setValue(now.x);
      motion.y.setValue(now.y);
      motion.zoom.setValue(now.zoom);
    }
  };
  // A finger added or lifted starts a new leg of the gesture from where the photo is now.
  const rebase = (fingers: number, dx: number, dy: number) => {
    leg = { from: now, spread: fingers, dx, dy };
  };
  const handlers = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => rebase(spread(e.nativeEvent.touches), 0, 0),
    onPanResponderMove: (e, g) => {
      const fingers = spread(e.nativeEvent.touches);
      if (fingers && !leg.spread) return rebase(fingers, g.dx, g.dy);
      if (!fingers && leg.spread) return rebase(0, g.dx, g.dy);
      const from = fingers ? zoomTo(leg.from, pinchScale(fingers, leg.spread, leg.from.zoom)) : leg.from;
      show({ zoom: from.zoom, x: from.x + g.dx - leg.dx, y: from.y + g.dy - leg.dy });
    },
  }).panHandlers;
  return { handlers, zoomBy: (factor: number) => show(zoomTo(now, now.zoom * factor), true), now: () => now };
}

/** `side` is the circle's size in points; Save hands back where the photo sits in it. */
export function PhotoCropper({
  photo,
  saving,
  onCancel,
  onSave,
}: {
  photo: ChosenPhoto;
  saving: boolean;
  onCancel: () => void;
  onSave: (view: CropView, side: number) => void;
}) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const side = Math.min(width - SPACE.xxl * 2, 360);
  const [motion] = useState(() => {
    const x = new Animated.Value(0);
    const y = new Animated.Value(0);
    const zoom = new Animated.Value(1);
    return { x, y, zoom, transform: [{ translateX: x }, { translateY: y }, { scale: Animated.multiply(zoom, 1 / SHARP) }] };
  });
  // Made again (back at the start) if the circle's size changes, e.g. on an iPad's Split View.
  const crop = useMemo(() => cropGesture(photo, side, motion, reduced), [photo, side, motion, reduced]);

  // The photo's size at zoom 1 (covering the circle), laid out SHARP times larger; the transform scales it.
  const base = Math.max(side / photo.width, side / photo.height) * SHARP;
  const laid = { width: photo.width * base, height: photo.height * base };
  // A ring this thick around the circle dims everything outside it, out to the stage's edges.
  const shade = Math.max(width, side);

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.top}>
            <Pressable onPress={onCancel} disabled={saving} accessibilityRole="button" hitSlop={SPACE.md}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.title} accessibilityRole="header">
              Move and zoom
            </Text>
            <View style={styles.topSpacer} />
          </View>

          <View style={styles.stage} {...crop.handlers} accessible accessibilityLabel="Your photo in the circle. Drag to move it, pinch to zoom.">
            <View style={{ width: side, height: side }}>
              <Animated.View
                style={{ position: 'absolute', width: laid.width, height: laid.height, left: (side - laid.width) / 2, top: (side - laid.height) / 2, transform: motion.transform }}
              >
                <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="fill" accessible={false} />
              </Animated.View>
              <View
                pointerEvents="none"
                style={[
                  styles.shade,
                  { left: -shade, top: -shade, width: side + shade * 2, height: side + shade * 2, borderRadius: side / 2 + shade, borderWidth: shade },
                ]}
              />
              <View pointerEvents="none" style={[styles.ring, { width: side, height: side, borderRadius: side / 2 }]} />
            </View>
          </View>

          <View style={styles.zoomRow}>
            <Pressable style={({ pressed }) => [styles.zoomButton, pressed && styles.pressed]} onPress={() => crop.zoomBy(1 / STEP)} accessibilityRole="button" accessibilityLabel="Zoom out">
              <SymbolView name={{ ios: 'minus.magnifyingglass', android: 'zoom_out' }} size={ICON.row} tintColor={WHITE} />
            </Pressable>
            <Text style={styles.hint}>Drag to move · pinch to zoom</Text>
            <Pressable style={({ pressed }) => [styles.zoomButton, pressed && styles.pressed]} onPress={() => crop.zoomBy(STEP)} accessibilityRole="button" accessibilityLabel="Zoom in">
              <SymbolView name={{ ios: 'plus.magnifyingglass', android: 'zoom_in' }} size={ICON.row} tintColor={WHITE} />
            </Pressable>
          </View>

          <View style={styles.bottom}>
            <Button title={saving ? 'Saving photo…' : 'Save'} onPress={() => onSave(crop.now(), side)} disabled={saving} />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

// Always dark, like iOS's own photo editing, whatever the app's appearance.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
  cancel: { ...TEXT.row, color: WHITE },
  title: { ...TYPE.section, color: WHITE },
  // Balances Cancel, so the title stays centered.
  topSpacer: { width: 56 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  shade: { position: 'absolute', borderColor: 'rgba(0,0,0,0.6)' },
  ring: { position: 'absolute', left: 0, top: 0, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)' },
  zoomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACE.xl, paddingVertical: SPACE.md },
  zoomButton: { width: 48, height: 48, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  pressed: { opacity: 0.6 },
  hint: { ...TEXT.note, color: 'rgba(255,255,255,0.75)' },
  bottom: { paddingHorizontal: SPACE.xxl, paddingBottom: SPACE.lg },
});
