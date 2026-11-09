// Each habit's own icon, like Apple Health's categories: an outline SF Symbol (a Material icon on
// Android), as in the A3 mockups. Kept's habits each have their own; a free tracker, which can be any
// habit, gets a seal. Decorative beside the habit's name, so VoiceOver skips it. ChallengeHeader is
// the icon, title and status line that open a challenge's, a check-in's and a tracker's screens.

import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { PageTitle } from '@/components/tab-title';
import { ICON, RADIUS, useColors } from '@/lib/theme';

const SYMBOLS: Record<string, SymbolViewProps['name']> = {
  read: { ios: 'book', android: 'menu_book' },
  language: { ios: 'character.bubble', android: 'translate' },
  workout: { ios: 'dumbbell', android: 'fitness_center' },
  'walk-run': { ios: 'figure.run', android: 'directions_run' },
  cook: { ios: 'frying.pan', android: 'skillet' },
  journal: { ios: 'pencil.and.scribble', android: 'edit_note' },
  instrument: { ios: 'music.note', android: 'music_note' },
  meditate: { ios: 'figure.mind.and.body', android: 'self_improvement' },
  stretch: { ios: 'figure.yoga', android: 'sports_gymnastics' },
  study: { ios: 'graduationcap', android: 'school' },
  leetcode: { ios: 'chevron.left.forwardslash.chevron.right', android: 'code' },
  // Off the list since 0044, for challenges started before it.
  write: { ios: 'doc.text', android: 'description' },
  code: { ios: 'chevron.left.forwardslash.chevron.right', android: 'code' },
  chess: { ios: 'checkerboard.rectangle', android: 'grid_on' },
  steps: { ios: 'figure.walk', android: 'directions_walk' },
  bike: { ios: 'figure.outdoor.cycle', android: 'directions_bike' },
  greens: { ios: 'leaf', android: 'eco' },
  draw: { ios: 'paintbrush.pointed', android: 'brush' },
};
const TRACKER: SymbolViewProps['name'] = { ios: 'checkmark.seal', android: 'verified' };

/**
 * `sm` sits at the start of a row or card (36); `lg` leads a tile or a choice in a grid (52).
 * `look`: `wash`, a green-washed square; `bare`, the icon alone in ink, heading a challenge card
 * (T100); `tile`, a raised white square with the icon in green, heading a challenge's screen (T101).
 */
export function HabitIcon({ habitId, size = 'sm', look = 'wash' }: { habitId?: string; size?: 'sm' | 'lg'; look?: 'wash' | 'bare' | 'tile' }) {
  const c = useColors();
  const box = look === 'tile' ? 60 : size === 'lg' ? 52 : 36;
  const surface = look === 'wash' ? { backgroundColor: c.selected } : look === 'tile' ? { backgroundColor: c.card, boxShadow: c.tileShadow || undefined } : null;
  return (
    <View style={[styles.box, { width: box, height: box }, surface]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <SymbolView
        name={(habitId && SYMBOLS[habitId]) || TRACKER}
        size={size === 'lg' || look !== 'wash' ? ICON.hero : ICON.row}
        tintColor={look === 'bare' ? c.text : c.link}
      />
    </View>
  );
}

/** A pushed screen's title: the habit's icon on a raised square, its name as the screen's one header, and a status line. */
export function ChallengeHeader({ habitId, title, status }: { habitId?: string; title: string; status: string }) {
  return <PageTitle title={title} subtitle={status} icon={<HabitIcon habitId={habitId} look="tile" />} />;
}

const styles = StyleSheet.create({
  box: { borderRadius: RADIUS.field + 4, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
});
