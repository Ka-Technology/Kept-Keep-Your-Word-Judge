// Start a challenge, step 1 of 5 (as in the A3 mockup since T109, full-set/sheet-new.jpg "habit"):
// "Pick a habit", from Kept's list (SPEC-challenges.md), under the headings Mind, Body, Food, Calm and
// Making (habitGroup(), from each habit's place in the list), two to a row, with a search box above
// them (owner, 2026-10-03: search only, since a staked challenge needs a habit Kept can check).
// Learn a language also asks for a language and a level, in a sheet that slides up the moment it's picked
// (T217, Santosh's review; it was under the whole list), with its own Next; closing the sheet without both
// unpicks it, and once both are chosen a line under the list says which, with Change. How the habit is
// checked shows under the list once one is picked. A habit (or language) that already has a running
// challenge can't start another (the database checks too).

import { router } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ChoiceGrid } from '@/components/choice-grid';
import { ErrorText } from '@/components/error-text';
import { Field } from '@/components/field';
import { HabitIcon } from '@/components/habit-icon';
import { BottomPanel } from '@/components/profile-fields';
import { Segmented } from '@/components/segmented';
import { LoadingScreen, StepScreen } from '@/components/step-screen';
import { useAuth } from '@/lib/auth';
import { duplicateChallengeError, HABIT_GROUPS, habitGroup, LANGUAGES, LEVELS, nameFor, type ChallengeDraft } from '@/lib/challenges';
import { confirmHealthHabit, isHealthHabit } from '@/lib/health-consent';
import { supabase } from '@/lib/supabase';
import { bareInputStyle, PLACEHOLDER_COLOR, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';
import { useChoices } from '@/lib/use-choices';
import { must, useFocusLoad } from '@/lib/use-focus-load';

export default function HabitStep() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { choices, failed, retry } = useChoices('habits');
  const [habitId, setHabitId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  // Learn a language's sheet, open from the moment it's picked until both questions are answered or it's closed.
  const [sheet, setSheet] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const { session, profile, updateProfile } = useAuth();
  const userId = session?.user.id;
  // The user's own challenges that haven't ended (friends' are readable too). If this can't load,
  // the database still refuses a duplicate.
  const running =
    useFocusLoad(async () => must(await supabase.from('challenges').select('habit_id, language').eq('user_id', userId!).is('outcome', null)), userId)
      .data ?? [];
  const isLanguage = habitId === 'language';

  if (!choices) return <LoadingScreen failed={failed} onRetry={retry} />;

  /** Picks a habit; Learn a language opens its sheet at once. */
  function pick(id: string) {
    setHabitId(id);
    if (id === 'language') setSheet(true);
  }

  /** Closing the sheet keeps Learn a language only with both of its answers. */
  function closeSheet() {
    setSheet(false);
    if (!language || !level) setHabitId(null);
  }

  const habit = choices.find((h) => h.id === habitId);
  // Shown as soon as it applies, not only after tapping Next.
  const duplicate = habit ? duplicateChallengeError(habit.id, isLanguage ? language : null, habit.name, running) : null;
  const missing = !habit
    ? 'Choose a habit.'
    : isLanguage && !language
      ? 'Choose a language.'
      : isLanguage && !level
        ? 'Choose a level.'
        : null;
  const problem = duplicate ?? missing;

  async function next() {
    setAttempted(true);
    if (problem || !habit) return AccessibilityInfo.announceForAccessibility(problem ?? '');
    // A health habit needs its own consent first (T179), asked once.
    if (isHealthHabit(habit.id) && !(await confirmHealthHabit(profile?.health_allowed ?? null, (v) => updateProfile({ health_allowed: v })))) return;
    const draft: Partial<ChallengeDraft> = { habitId: habit.id, habitName: habit.name };
    if (isLanguage && language && level) Object.assign(draft, { language, level });
    router.push({ pathname: '/challenge/new/length', params: draft });
  }

  // Kept's habits under their headings (Mind, Body, …), each heading only while it has a match.
  const q = search.trim().toLowerCase();
  const groups = HABIT_GROUPS.map((group) => ({
    group,
    habits: choices.filter((h) => habitGroup(h.position) === group && h.name.toLowerCase().includes(q)),
  })).filter((g) => g.habits.length > 0);

  return (
    <StepScreen step={1} question="Pick a habit" error={duplicate ?? (attempted ? problem : null)} onPress={next} showButton={!missing}>
      <Field icon={{ ios: 'magnifyingglass', android: 'search' }}>
        <TextInput
          style={bareInputStyle(colors)}
          placeholder="Search habits…"
          placeholderTextColor={PLACEHOLDER_COLOR}
          accessibilityLabel="Search habits"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </Field>
      {groups.length === 0 && (
        <Text style={styles.label}>No habit on Kept’s list matches. Staked challenges use habits Kept can check; for anything else, start a free tracker.</Text>
      )}
      {groups.map(({ group, habits }) => (
        <View key={group} style={styles.group}>
          <Text style={styles.heading} accessibilityRole="header">
            {group}
          </Text>
          <ChoiceGrid
            label={`${group} habits`}
            columns={2}
            options={habits}
            value={habitId}
            onChange={pick}
            icon={(id) => <HabitIcon habitId={id} look="bare" />}
            note={(id) => (id !== 'language' && running.some((c) => c.habit_id === id) ? 'Already running' : undefined)}
          />
        </View>
      ))}
      <Text style={styles.label}>
        {habit?.detail ? `How it’s checked: ${habit.detail}` : 'Kept only offers habits it can check. Each one shows how it’s checked once you pick it.'}
      </Text>
      {isLanguage && language && level && (
        <View style={styles.chosen}>
          <Text style={styles.chosenText}>
            {nameFor(LANGUAGES, language)}, {nameFor(LEVELS, level).toLowerCase()}
          </Text>
          <Button title="Change" onPress={() => setSheet(true)} variant="link" />
        </View>
      )}

      <BottomPanel visible={sheet} title="Learn a language" buttonTitle="Close" onClose={closeSheet} panelStyle={styles.sheet}>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          {!!habit?.detail && isLanguage && <Text style={styles.label}>How it’s checked: {habit.detail}</Text>}
          <View style={styles.field}>
            <Text style={styles.label}>Language</Text>
            <ChoiceGrid
              label="Language"
              columns={2}
              options={LANGUAGES.map((l) => ({ id: l.code, name: l.name }))}
              value={language}
              onChange={setLanguage}
              note={(code) => (running.some((c) => c.habit_id === 'language' && c.language === code) ? 'Already running' : undefined)}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Level</Text>
            <Segmented label="Level" options={LEVELS.map((l) => ({ value: l.code, label: l.name }))} value={level} onChange={setLevel} />
          </View>
          <ErrorText message={duplicate} />
          <Button
            title="Next"
            onPress={() => {
              setSheet(false);
              next();
            }}
            disabled={!language || !level || !!duplicate}
          />
        </ScrollView>
      </BottomPanel>
    </StepScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    field: { gap: SPACE.sm },
    group: { gap: SPACE.sm },
    heading: { ...TEXT.row, color: c.secondaryText, marginHorizontal: SPACE.xs },
    label: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
    chosen: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: SPACE.xs },
    chosenText: { ...TEXT.row, color: c.text, fontWeight: '600' },
    // Tall enough for the eight languages, the levels and Next; it scrolls on a small phone or with large text.
    sheet: { height: '78%' },
    sheetBody: { gap: SPACE.lg, padding: SPACE.lg, paddingBottom: SPACE.xxl },
  });
