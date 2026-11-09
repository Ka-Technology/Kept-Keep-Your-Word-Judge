// Change-password screen, opened from Settings for email accounts (T39). It checks the current
// password by signing in with it, then saves the new one with the same rules as sign-up.
// ponytail: the check is in the app. Supabase can also enforce it server-side (an auth setting this
// CLI's config.toml can't set yet); turn that on before real money, and pass current_password too.
// As in the A3 mockup since T126 (full-set/ui-push-7-change-password.jpg): "Change password" large,
// a "Current password" card, the "New password" card with its rules, the confirm card, Save password.

import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Alert, ScrollView, StyleSheet, type TextInputInstance } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { NewPasswordFields } from '@/components/new-password-fields';
import { PasswordInput } from '@/components/password-input';
import { PageTitle } from '@/components/tab-title';
import { useAuth } from '@/lib/auth';
import {
  authErrorMessage,
  changePasswordErrorMessage,
  isStrongPassword,
  LEAKED_PASSWORD_MESSAGE,
  PASSWORD_MISMATCH_MESSAGE,
  PASSWORD_RULE_MESSAGE,
} from '@/lib/auth-state';
import { isLeakedPassword } from '@/lib/leaked-password';
import { supabase } from '@/lib/supabase';
import { COLUMN, SPACE, useStyles, type Colors } from '@/lib/theme';

const CURRENT_MISSING_MESSAGE = 'Enter your current password.';

export default function ChangePassword() {
  const styles = useStyles(makeStyles);
  const { session } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Read synchronously, so a double tap can't send two requests.
  const inFlight = useRef(false);
  const newPasswordRef = useRef<TextInputInstance>(null);

  /** Shows an error under the form and reads it out to VoiceOver users. */
  function showError(message: string) {
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
  }

  /** Checks the form, confirms the current password, then saves the new one. */
  async function save() {
    if (inFlight.current) return;
    setAttempted(true);
    setError(null);
    if (current === '') return showError(CURRENT_MISSING_MESSAGE);
    if (!isStrongPassword(password) || confirm !== password) {
      AccessibilityInfo.announceForAccessibility(isStrongPassword(password) ? PASSWORD_MISMATCH_MESSAGE : PASSWORD_RULE_MESSAGE);
      return;
    }
    const email = session?.user.email;
    if (!email) return showError(authErrorMessage({}));

    inFlight.current = true;
    setSaving(true);
    try {
      // A password from a known data breach is refused (leaked-password.ts).
      if (await isLeakedPassword(password)) return showError(LEAKED_PASSWORD_MESSAGE);
      const checked = await supabase.auth.signInWithPassword({ email, password: current });
      if (checked.error) return showError(changePasswordErrorMessage(checked.error));
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return showError(changePasswordErrorMessage(error));
      // Stay on this screen until the user has read and dismissed the confirmation.
      Alert.alert('Password changed', 'Use your new password the next time you sign in.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch {
      showError(authErrorMessage({}));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      <PageTitle title="Change password" />
      <PasswordInput
        label="Current password"
        placeholder="Your password now"
        accessibilityLabel="Current password"
        value={current}
        onChangeText={(text) => {
          setCurrent(text);
          setError(null);
        }}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => newPasswordRef.current?.focus()}
        autoFocus
      />
      <NewPasswordFields
        label="New password"
        password={password}
        confirm={confirm}
        onChangePassword={setPassword}
        onChangeConfirm={setConfirm}
        showErrors={attempted}
        passwordRef={newPasswordRef}
      />
      <ErrorText message={error} />
      <Button title={saving ? 'Saving…' : 'Save password'} onPress={save} disabled={saving} />
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: { ...COLUMN, padding: SPACE.lg, gap: SPACE.md },
  });
