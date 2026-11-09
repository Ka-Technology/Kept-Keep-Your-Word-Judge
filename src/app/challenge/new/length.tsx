// Start a challenge, step 2 of 5 (as in the A3 mockup since T110, full-set/sheet-new.jpg "length"):
// how many completed days, from 28 (the minimum) to 365, in one card: the choice as one big number
// ("28 days"), the common lengths as one-tap chips (owner, 2026-10-02; Other opens a number box), and
// when Day 1 is, and why: today is for setting up. Under the number, the same length in weeks (T213).

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, TextInput, View } from 'react-native';

import { Segmented } from '@/components/segmented';
import { StepScreen } from '@/components/step-screen';
import { Tile } from '@/components/tile';
import { deviceTimeZone, LENGTH_LIMITS, lengthError, parseWholeNumber, startDate, weeksLabel, type ChallengeDraft } from '@/lib/challenges';
import { fromDateString } from '@/lib/profile';
import { HERO_MAX_SCALE, inputStyle, PLACEHOLDER_COLOR, SPACE, TEXT, TYPE, useStyles, type Colors } from '@/lib/theme';

/** One-tap lengths, in completed days: four weeks, six, eight, and about three months. */
const PRESETS = ['28', '42', '56', '90'];

export default function LengthStep() {
  const styles = useStyles(makeStyles);
  const draft = useLocalSearchParams<ChallengeDraft>();
  const [text, setText] = useState(String(LENGTH_LIMITS.minDays));
  const [other, setOther] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const days = parseWholeNumber(text);
  const problem = lengthError(days);
  const choice = other || !PRESETS.includes(text) ? 'other' : text;

  function choose(value: string) {
    setOther(value === 'other');
    if (value !== 'other') setText(value);
  }

  function next() {
    setAttempted(true);
    if (problem) return AccessibilityInfo.announceForAccessibility(problem);
    router.push({ pathname: '/challenge/new/stake', params: { ...draft, days: String(days) } });
  }

  // e.g. "Sunday, October 19": Day 1 is tomorrow in the phone's zone, where the challenge will run.
  const start = fromDateString(startDate(deviceTimeZone(), new Date())).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <StepScreen step={2} question="How many days?" error={attempted || text !== '' ? problem : null} onPress={next}>
      <Tile style={styles.card}>
        <View style={styles.big} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.number} maxFontSizeMultiplier={HERO_MAX_SCALE}>
            {days ?? '–'}
          </Text>
          <Text style={styles.unit}>days</Text>
        </View>
        {/* The same length in weeks, so 42, 56 and 90 need no arithmetic (T213, Santosh's review). */}
        {days !== null && days > 0 && <Text style={styles.weeks}>{weeksLabel(days)}</Text>}
        <Segmented
          look="chips"
          label="Number of completed days"
          options={[...PRESETS.map((d) => ({ value: d, label: d })), { value: 'other', label: 'Other' }]}
          value={choice}
          onChange={choose}
        />
        {/* Day 1 is the day after signing (SPEC-challenges.md), so a late-night start can't cost a shield. */}
        <Text style={styles.start}>Starts tomorrow, {start}. Today is for setting up.</Text>
      </Tile>
      {choice === 'other' && (
        <TextInput
          style={styles.input}
          placeholder={`${LENGTH_LIMITS.minDays} to ${LENGTH_LIMITS.maxDays}`}
          placeholderTextColor={PLACEHOLDER_COLOR}
          accessibilityLabel="Number of completed days"
          value={text}
          onChangeText={setText}
          keyboardType="number-pad"
          returnKeyType="done"
          maxLength={3}
          autoFocus
        />
      )}
      <Text style={styles.explanation}>
        At least {LENGTH_LIMITS.minDays}, up to {LENGTH_LIMITS.maxDays}. A day counts once it&apos;s checked. Each missed day
        breaks one of your 2 shields and adds a day to the end, so it can take a little longer.
      </Text>
    </StepScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: { gap: SPACE.lg, padding: SPACE.xl },
    big: { flexDirection: 'row', alignItems: 'baseline', gap: SPACE.sm },
    number: { ...TYPE.hero, fontSize: 88, lineHeight: 92, color: c.text },
    unit: { ...TYPE.title, color: c.secondaryText },
    weeks: { ...TEXT.row, color: c.secondaryText, marginTop: -SPACE.md },
    start: { ...TEXT.note, color: c.secondaryText },
    input: { ...inputStyle(c), fontFamily: TYPE.number.fontFamily, fontSize: TYPE.number.fontSize, textAlign: 'center' },
    explanation: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
  });
