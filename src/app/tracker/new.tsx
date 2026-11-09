// Track a habit for free (owner, 2026-10-01; docs/specs/SPEC-trackers.md), the "just for me" side of
// Start a challenge (challenge/new/index.tsx): any habit the user names,
// with Kept's habits as quick picks; an open-ended streak or a goal of N days; and 0 to 3 shields. No
// money, photo, AI or friends: the user taps Done for themselves. The database checks the same
// rules (migration 0040). The name box comes first and also searches Kept's habits, shown below it in
// the same icon grid as a staked challenge's habit step (owner, 2026-10-03): tap one, or keep typing
// your own. As in the A3 mockup since T138 (full-set/ui-flow-5-tracker-new.jpg): "Track a habit" and
// "Free. No money, photos or friends.", then the streak or goal and the shields, Start tracking. Since T216
// (decision 175, Santosh's review): five of Kept's habits and Other as tiles, three to a row; a habit tile just
// picks it, and Other opens an empty "Name your habit" box that suggests Kept's habits as you type.

import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { Field } from '@/components/field';
import { HabitIcon } from '@/components/habit-icon';
import { Segmented } from '@/components/segmented';
import { PageTitle } from '@/components/tab-title';
import { deviceTimeZone, parseWholeNumber } from '@/lib/challenges';
import { useAuth } from '@/lib/auth';
import { confirmHealthHabit, healthHabitNamed } from '@/lib/health-consent';
import { askForNotifications } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { bareInputStyle, ICON, inputStyle, PLACEHOLDER_COLOR, RADIUS, SCREEN, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';
import { TRACKER_LIMITS, TRACKER_QUICK_PICKS, trackerError, trackerErrorMessage, trackerSuggestions } from '@/lib/trackers';
import { useChoices } from '@/lib/use-choices';

export default function NewTracker() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  // Kept's habits, as quick picks for the name; without them, the name field still works.
  const habits = useChoices('habits').choices;
  const { profile, updateProfile } = useAuth();
  const [name, setName] = useState('');
  // The Other tile: the name box shows, for a habit of the user's own.
  const [other, setOther] = useState(false);
  const picked = habits?.find((h) => h.name === name.trim());
  const [hasGoal, setHasGoal] = useState<'streak' | 'goal'>('streak');
  const [goalText, setGoalText] = useState('30');
  const [shields, setShields] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Read synchronously, so a double tap can't make two trackers.
  const inFlight = useRef(false);

  async function save() {
    if (inFlight.current) return;
    const goalDays = hasGoal === 'goal' ? parseWholeNumber(goalText) ?? 0 : null;
    const problem = trackerError(name, goalDays, shields);
    if (problem) {
      setError(problem);
      return AccessibilityInfo.announceForAccessibility(problem);
    }
    inFlight.current = true;
    // A health habit needs its own consent first (T179), asked once.
    if (habits && healthHabitNamed(name, habits) && !(await confirmHealthHabit(profile?.health_allowed ?? null, (v) => updateProfile({ health_allowed: v })))) {
      inFlight.current = false;
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error } = await supabase
      .from('trackers')
      .insert({ name: name.trim(), goal_days: goalDays, shields, time_zone: deviceTimeZone() })
      .select('id')
      .single();
    inFlight.current = false;
    setSaving(false);
    if (error) {
      const message = trackerErrorMessage(error);
      setError(message);
      return AccessibilityInfo.announceForAccessibility(message);
    }
    // Close Start a challenge, then open the new tracker from wherever the user started.
    router.dismissAll();
    router.push({ pathname: '/tracker/[id]', params: { id: data.id } });
    // Its 8 pm reminder is now useful: iOS asks once, the first time, then the reminders are scheduled.
    askForNotifications();
  }

  // Five of Kept's habits, then Other; under Other, Kept's habits that match what's typed.
  const tiles = habits ? TRACKER_QUICK_PICKS.map((id) => habits.find((h) => h.id === id)).filter((h) => !!h) : [];
  const suggestions = other && habits ? trackerSuggestions(name, habits).filter((h) => h.id !== picked?.id) : [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      <PageTitle title="Track a habit" subtitle="Free. No money, photos or friends." />

      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="The habit to track">
        {tiles.map((h) => {
          const selected = !other && h.id === picked?.id;
          return (
            <Pressable
              key={h.id}
              style={({ pressed }) => [styles.tile, selected && styles.selected, pressed && styles.pressed]}
              onPress={() => {
                setOther(false);
                setName(h.name);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={h.name}
            >
              <HabitIcon habitId={h.id} size="lg" look="bare" />
              <Text style={[styles.tileName, selected && styles.tileNameSelected]} numberOfLines={2}>
                {h.name}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          style={({ pressed }) => [styles.tile, other && styles.selected, pressed && styles.pressed]}
          onPress={() => {
            if (other) return;
            setOther(true);
            setName('');
          }}
          accessibilityRole="radio"
          accessibilityState={{ checked: other }}
          accessibilityLabel="Other: name your own habit"
        >
          <SymbolView name={{ ios: 'square.and.pencil', android: 'edit_note' }} size={ICON.hero} tintColor={other ? colors.text : colors.secondaryText} />
          <Text style={[styles.tileName, other && styles.tileNameSelected]} numberOfLines={2}>
            Other
          </Text>
        </Pressable>
      </View>

      {other && (
        <>
          <Field icon={{ ios: 'pencil', android: 'edit' }}>
            <TextInput
              style={bareInputStyle(colors)}
              placeholder="Name your habit"
              placeholderTextColor={PLACEHOLDER_COLOR}
              accessibilityLabel="Name your habit. Also suggests Kept’s habits"
              value={name}
              onChangeText={setName}
              maxLength={TRACKER_LIMITS.nameMax}
              clearButtonMode="while-editing"
              returnKeyType="done"
              autoFocus
            />
          </Field>
          {suggestions.map((h) => (
            <Pressable
              key={h.id}
              style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
              onPress={() => setName(h.name)}
              accessibilityRole="button"
              accessibilityLabel={`Use ${h.name}`}
            >
              <HabitIcon habitId={h.id} />
              <Text style={styles.body}>{h.name}</Text>
            </Pressable>
          ))}
          {name.trim() !== '' && !picked && suggestions.length === 0 && (
            <Text style={styles.note}>“{name.trim()}” isn’t on Kept’s list, so it’ll be your own habit.</Text>
          )}
        </>
      )}

      <View style={styles.section}>
        <Text style={styles.label}>How it runs</Text>
        <Segmented
          label="How it runs"
          options={[
            { value: 'streak', label: 'Open-ended streak' },
            { value: 'goal', label: 'A goal' },
          ]}
          value={hasGoal}
          onChange={setHasGoal}
        />
        {hasGoal === 'goal' && (
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.number]}
              accessibilityLabel="Goal in days"
              value={goalText}
              onChangeText={setGoalText}
              keyboardType="number-pad"
              returnKeyType="done"
              maxLength={3}
            />
            <Text style={styles.body}>days</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Shields</Text>
        <Segmented label="Shields" options={[0, 1, 2, 3].map((n) => ({ value: n, label: String(n) }))} value={shields} onChange={setShields} />
        <Text style={styles.note}>
          {hasGoal === 'goal'
            ? 'A missed day breaks a shield. A miss with no shield left ends the goal.'
            : 'A missed day breaks a shield. A miss with no shield left starts your streak over, with your shields back.'}{' '}
          Tap Done each day you keep it. Only you see it.
        </Text>
      </View>

      <ErrorText message={error} />
      <Button title={saving ? 'Saving…' : 'Start tracking'} onPress={save} disabled={saving} />
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: SCREEN,
    body: { ...TEXT.body, color: c.text },
    section: { gap: SPACE.sm },
    label: { ...TEXT.caption, color: c.secondaryText, marginLeft: SPACE.xs },
    note: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
    input: inputStyle(c),
    number: { width: 90, textAlign: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
    // Three to a row: a third of the width, less the gaps.
    tile: {
      width: '31.5%',
      minHeight: 120,
      gap: SPACE.md,
      padding: SPACE.md,
      justifyContent: 'center',
      borderRadius: RADIUS.tile,
      borderCurve: 'continuous',
      borderWidth: 2,
      borderColor: 'transparent',
      backgroundColor: c.card,
      boxShadow: c.tileShadow || undefined,
    },
    selected: { borderColor: c.stamp },
    pressed: { opacity: 0.7 },
    tileName: { ...TEXT.row, color: c.secondaryText },
    tileNameSelected: { color: c.text, fontWeight: '700' },
    suggestion: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.xs, paddingHorizontal: SPACE.xs },
  });
