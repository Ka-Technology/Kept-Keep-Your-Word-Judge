// Edit-name screen, opened from Personal information (T145, decision 100): first and last name, the
// same rule as sign-up (nameError()). Accounts from before 0050 add theirs here. Only the user sees
// them. Saving updates the profile and goes back. Laid out like Your username (T125, T128): "Your
// name" large, a field card for each name.

import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, TextInput, type TextInputInstance } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { Field } from '@/components/field';
import { PageTitle } from '@/components/tab-title';
import { useAuth } from '@/lib/auth';
import { nameError, profileSaveMessage } from '@/lib/profile';
import { bareInputStyle, COLUMN, PLACEHOLDER_COLOR, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';

export default function EditName() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { profile, updateProfile } = useAuth();
  const [first, setFirst] = useState(profile?.first_name ?? '');
  const [last, setLast] = useState(profile?.last_name ?? '');
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lastRef = useRef<TextInputInstance>(null);
  // Read synchronously, so a Return-key press and a button tap in the same frame can't both save.
  const inFlight = useRef(false);

  const firstError = attempted ? nameError(first, 'first') : undefined;
  const lastError = attempted ? nameError(last, 'last') : undefined;

  /** Checks both names, saves them trimmed, and goes back. Unchanged names just go back. */
  async function save() {
    if (inFlight.current) return;
    setAttempted(true);
    const problem = nameError(first, 'first') ?? nameError(last, 'last');
    if (problem) return AccessibilityInfo.announceForAccessibility(problem);
    const fields = { first_name: first.trim(), last_name: last.trim() };
    if (fields.first_name === profile?.first_name && fields.last_name === profile?.last_name) return router.back();

    inFlight.current = true;
    setSaving(true);
    setError(null);
    const result = await updateProfile(fields);
    inFlight.current = false;
    setSaving(false);
    if (result === 'saved') return router.back();
    const message = profileSaveMessage(result);
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      <PageTitle title="Your name" />
      <Field label="First name" error={firstError}>
        <TextInput
          style={bareInputStyle(colors)}
          placeholder="First name"
          placeholderTextColor={PLACEHOLDER_COLOR}
          accessibilityLabel="First name"
          value={first}
          onChangeText={setFirst}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="given-name"
          textContentType="givenName"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => lastRef.current?.focus()}
          autoFocus
        />
      </Field>
      <Field label="Last name" error={lastError}>
        <TextInput
          ref={lastRef}
          style={bareInputStyle(colors)}
          placeholder="Last name"
          placeholderTextColor={PLACEHOLDER_COLOR}
          accessibilityLabel="Last name"
          value={last}
          onChangeText={setLast}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="family-name"
          textContentType="familyName"
          returnKeyType="done"
          onSubmitEditing={save}
        />
      </Field>
      <Text style={styles.hint}>Your legal name, for donation receipts. Only you see it.</Text>
      <ErrorText message={error} />
      <Button title={saving ? 'Saving…' : 'Save'} onPress={save} disabled={saving} />
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: { ...COLUMN, padding: SPACE.lg, gap: SPACE.md },
    hint: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
  });
