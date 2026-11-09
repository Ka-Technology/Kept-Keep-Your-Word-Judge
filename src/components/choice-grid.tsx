// A choice laid out as tiles instead of a dropdown (owner, 2026-10-02; A3, T109): Kept's habits as a
// two-column grid of rows (the icon beside the name), its charities as a column of cards with what
// each does and a check circle. The chosen tile takes a green border, with a light selection tap.
// VoiceOver reads it as a radio group, each tile with its selected state and its explanation. Searching
// is the screen's job (the habit step filters before it hands the options over).

import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SwipeRow } from '@/components/swipe-row';
import { ICON, RADIUS, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import type { ChoiceOption } from '@/lib/use-choices';

export function ChoiceGrid({
  label,
  options,
  value,
  onChange,
  columns = 1,
  icon,
  note,
  swipe,
}: {
  /** Names the group for VoiceOver, e.g. "Habit". */
  label: string;
  options: ChoiceOption[];
  value: string | null;
  onChange: (id: string) => void;
  /** 2 lays tiles out in a grid, without their explanations (show the chosen one's below instead). */
  columns?: 1 | 2;
  /** Something at the start of each tile, e.g. the habit's icon. */
  icon?: (id: string) => ReactNode;
  /** A short tag on a tile, e.g. "Running" for a habit that already has a challenge. */
  note?: (id: string) => string | undefined;
  /** One column only: a card can be swiped to the left, or held, to learn more about it (swipe-row.tsx). */
  swipe?: { canLearn: (id: string) => boolean; onLearn: (id: string) => void };
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  return (
    <View style={[styles.wrap, columns === 2 && styles.grid]} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const selected = o.id === value;
        const tag = note?.(o.id);
        const tile = (
          <Pressable
            key={o.id}
            onPress={() => {
              if (!selected) Haptics.selectionAsync();
              onChange(o.id);
            }}
            // Holding a card opens its page, the same as swiping it left.
            onLongPress={
              swipe?.canLearn(o.id)
                ? () => {
                    Haptics.selectionAsync();
                    swipe.onLearn(o.id);
                  }
                : undefined
            }
            style={({ pressed }) => [styles.tile, columns === 2 && styles.half, selected && styles.selected, pressed && styles.pressed]}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={[o.name, tag, columns === 1 ? o.detail : undefined].filter(Boolean).join('. ')}
          >
            {icon?.(o.id)}
            <View style={styles.text}>
              <Text style={columns === 2 ? styles.gridName : styles.name}>{o.name}</Text>
              {tag && <Text style={styles.tag}>{tag}</Text>}
              {columns === 1 && o.detail && <Text style={styles.detail}>{o.detail}</Text>}
            </View>
            {columns === 1 && (
              <SymbolView
                name={selected ? { ios: 'checkmark.circle.fill', android: 'check_circle' } : { ios: 'circle', android: 'radio_button_unchecked' }}
                size={ICON.row}
                tintColor={selected ? colors.stamp : colors.chevron}
              />
            )}
          </Pressable>
        );
        return swipe && columns === 1 ? (
          <SwipeRow key={o.id} canLearn={swipe.canLearn(o.id)} onLearn={() => swipe.onLearn(o.id)}>
            {tile}
          </SwipeRow>
        ) : (
          tile
        );
      })}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    wrap: { gap: SPACE.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    // A row: the icon, the name (and its explanation), and on a one-column list a check circle (A3, T109).
    tile: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.card,
      borderRadius: RADIUS.card,
      borderCurve: 'continuous',
      borderWidth: 2,
      borderColor: 'transparent',
      paddingHorizontal: SPACE.md,
      paddingVertical: SPACE.md,
      gap: SPACE.md,
      minHeight: 64,
      boxShadow: c.tileShadow || undefined,
    },
    // Two to a row, with the row's gap between them.
    half: { width: '48%', flexGrow: 1 },
    selected: { borderColor: c.stamp },
    pressed: { opacity: 0.7 },
    text: { flex: 1, gap: SPACE.xxs },
    gridName: { ...TEXT.row, fontWeight: '600', color: c.text },
    name: { ...TYPE.section, color: c.text },
    tag: { ...TEXT.caption, color: c.error, fontWeight: '600' },
    detail: { ...TEXT.note, color: c.secondaryText },
  });
