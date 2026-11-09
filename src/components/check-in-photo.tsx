// A check-in photo with Kept's stamp drawn over it (SPEC-verification.md: the stamp is shown, not
// written into the file). It loads the private photo's short-lived address itself. Used on the
// check-in screen and the review screen. As in the A3 mockups (T102): a square photo with its day and
// time in a dark chip in one corner, and on a sent or kept day the green K box set down on it
// (`stamp`: 'land' drops it in with the stamp-down, 'still' just shows it).

import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { DayStamp, useStampDown } from '@/components/big-stamp';
import { stampText } from '@/lib/check-in';
import { checkInPhotoUrl } from '@/lib/check-in-photos';
import { PHOTO_BAND, RADIUS, SPACE, TEXT, WHITE, useColors, useStyles, type Colors } from '@/lib/theme';

export function CheckInPhoto({
  path,
  day,
  takenAt,
  timeZone,
  label,
  chipAt = 'bottom',
  stamp,
}: {
  path: string;
  day: number;
  takenAt: string | null;
  timeZone: string;
  /** What VoiceOver reads, e.g. "Your check-in photo". */
  label: string;
  /** Which corner the day-and-time chip sits in (right side either way). */
  chipAt?: 'top' | 'bottom';
  stamp?: 'land' | 'still';
}) {
  const styles = useStyles(makeStyles);
  const c = useColors();
  // The address, kept with the path it's for, so a new photo never shows the old one.
  const [photo, setPhoto] = useState<{ path: string; url: string | null } | null>(null);
  const down = useStampDown(stamp === 'land');

  useEffect(() => {
    let current = true;
    checkInPhotoUrl(path).then((url) => current && setPhoto({ path, url }));
    return () => {
      current = false;
    };
  }, [path]);

  const url = photo?.path === path ? photo.url : null;
  return (
    <View style={styles.box}>
      {url && <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={label} />}
      {stamp && (
        <Animated.View style={[styles.stamp, down]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <DayStamp kind="kept" color={c.stamp} size="100%" />
        </Animated.View>
      )}
      {takenAt && (
        <View style={[styles.chip, chipAt === 'top' ? styles.top : styles.bottom]}>
          <SymbolView name={{ ios: 'camera', android: 'photo_camera' }} size={14} tintColor={WHITE} />
          <Text style={styles.chipText}>{stampText(day, new Date(takenAt), timeZone)}</Text>
        </View>
      )}
    </View>
  );
}

/** A small square of a check-in photo, at the start of a row (a friend's check-in to review, T105). Decorative. */
export function PhotoThumb({ path, size = 56 }: { path: string; size?: number }) {
  const styles = useStyles(makeStyles);
  const [photo, setPhoto] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    let current = true;
    checkInPhotoUrl(path).then((url) => current && setPhoto({ path, url }));
    return () => {
      current = false;
    };
  }, [path]);
  const url = photo?.path === path ? photo.url : null;
  return (
    <View style={[styles.thumb, { width: size, height: size }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {url && <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    thumb: { borderRadius: RADIUS.field, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.track },
    box: { width: '100%', aspectRatio: 1, borderRadius: RADIUS.tile, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.card },
    // The K box, about a third of the photo, in its middle.
    stamp: { position: 'absolute', width: '42%', aspectRatio: 1, alignSelf: 'center', top: '29%' },
    // White on a dark pill, readable on any photo, in both light and dark mode.
    chip: {
      position: 'absolute',
      right: SPACE.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.xs,
      paddingVertical: SPACE.xs,
      paddingHorizontal: SPACE.sm,
      borderRadius: RADIUS.pill,
      backgroundColor: PHOTO_BAND,
    },
    top: { top: SPACE.md },
    bottom: { bottom: SPACE.md },
    chipText: { ...TEXT.caption, color: WHITE, fontWeight: '600' },
  });
