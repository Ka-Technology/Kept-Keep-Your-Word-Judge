// A row of 2–4 mutually exclusive choices (like iOS's segmented control), e.g. a challenge's length
// or the way to pay: a pill track whose raised thumb slides to the chosen option, with a light
// selection tap (straight there under Reduce Motion). VoiceOver reads it as a radio group, with
// each choice's selected state.

import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { RADIUS, SPACE, TEXT, useStyles, type Colors } from '@/lib/theme';
import { useReducedMotion } from '@/lib/use-reduced-motion';

const INSET = 4;

/**
 * `value` is the chosen option (null for none yet); `label` names the group for VoiceOver. `look`
 * "chips" lays the options out as separate outlined pills instead of a track, the chosen one outlined
 * in green (A3, T110: a challenge's length, a pledge's amount).
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  look = 'track',
}: {
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  look?: 'track' | 'chips';
}) {
  const styles = useStyles(makeStyles);
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = options.findIndex((o) => o.value === value);
  const segment = (width - INSET * 2) / options.length;
  const [x] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (index < 0 || !segment) return;
    const to = index * segment;
    if (reduced) x.setValue(to);
    else Animated.spring(x, { toValue: to, useNativeDriver: true, speed: 24, bounciness: 2 }).start();
  }, [index, segment, reduced, x]);

  if (look === 'chips') {
    return (
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              style={({ pressed }) => [styles.chip, selected && styles.chipChosen, pressed && !selected && styles.pressed]}
              onPress={() => {
                if (!selected) Haptics.selectionAsync();
                onChange(option.value);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={option.label}
            >
              {/* One line: five chips share a row, and "Other" broke as "Othe / r" (owner, 2026-11-02). */}
              <Text style={[styles.chipText, selected && styles.chipTextChosen]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View
      style={styles.track}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {index >= 0 && segment > 0 && <Animated.View style={[styles.thumb, { width: segment, transform: [{ translateX: x }] }]} />}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            style={({ pressed }) => [styles.option, pressed && !selected && styles.pressed]}
            onPress={() => {
              if (!selected) Haptics.selectionAsync();
              onChange(option.value);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={option.label}
          >
            <Text style={[styles.text, selected && styles.selectedText]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    track: { flexDirection: 'row', padding: INSET, borderRadius: RADIUS.pill, backgroundColor: c.track },
    thumb: {
      position: 'absolute',
      top: INSET,
      bottom: INSET,
      left: INSET,
      borderRadius: RADIUS.pill,
      backgroundColor: c.thumb,
      boxShadow: c.tileShadow || undefined,
    },
    option: { flex: 1, minHeight: 44, paddingHorizontal: SPACE.sm, alignItems: 'center', justifyContent: 'center' },
    pressed: { opacity: 0.6 },
    text: { ...TEXT.note, color: c.secondaryText, textAlign: 'center' },
    selectedText: { color: c.text, fontWeight: '600' },
    chips: { flexDirection: 'row', gap: SPACE.sm },
    chip: {
      flex: 1,
      minHeight: 48,
      paddingHorizontal: SPACE.xs,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: RADIUS.field,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: c.separator,
      backgroundColor: c.card,
    },
    chipChosen: { borderWidth: 2, borderColor: c.stamp },
    chipText: { ...TEXT.row, color: c.secondaryText, textAlign: 'center' },
    chipTextChosen: { color: c.text, fontWeight: '700' },
  });
