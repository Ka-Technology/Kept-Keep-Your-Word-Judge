// Change-email screen, opened from Personal information for email accounts (T207, plan.md decision 168). The new
// address first; then, with Supabase's secure email change (`double_confirm_changes`), a code goes to each address,
// and the change needs both: the old address's code (only its owner can read it, so no password is asked) and the
// new one's. Each is checked against the address it was sent to (GoTrue hashes the two together); the first answers
// "accepted", the second makes the change and a new session. Stripe's receipts follow the next time Payment methods
// opens (`payments`' setup). Laid out like Your name: "Change email" large, a field card, then one code at a time.

import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Alert, ScrollView, StyleSheet, Text, TextInput } from 'react-native';

import { Button } from '@/components/button';
import { CodeInput } from '@/components/code-input';
import { ErrorText } from '@/components/error-text';
import { Field } from '@/components/field';
import { PageTitle } from '@/components/tab-title';
import { useAuth } from '@/lib/auth';
import { CODE_LIFETIME, EMAIL_FORMAT_MESSAGE, emailChangeErrorMessage, isValidCode, isValidEmail, OTP_LENGTH } from '@/lib/auth-state';
import { supabase } from '@/lib/supabase';
import { bareInputStyle, COLUMN, PLACEHOLDER_COLOR, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';

/** Typing the new address, then the old address's code, then the new one's. */
type Step = 'address' | 'old' | 'new';

export default function ChangeEmail() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { session } = useAuth();
  const current = session?.user.email ?? '';
  const [step, setStep] = useState<Step>('address');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Read synchronously, so a double tap can't send two requests.
  const inFlight = useRef(false);
  const next = address.trim().toLowerCase();

  /** Shows an error under the form and reads it out to VoiceOver users. */
  function showError(message: string) {
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
  }

  /** Runs one request at a time, with its error said plainly. */
  async function run(request: () => Promise<{ error: { code?: string; name?: string; message?: string } | null }>, onDone: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { error } = await request();
      if (error) return showError(emailChangeErrorMessage(error));
      onDone();
    } catch {
      showError(emailChangeErrorMessage({}));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /** Asks Supabase to send the two codes (again, from the code steps). */
  function sendCodes() {
    if (!isValidEmail(next)) return showError(EMAIL_FORMAT_MESSAGE);
    if (next === current.toLowerCase()) return showError('That’s already your email.');
    run(
      () => supabase.auth.updateUser({ email: next }),
      () => {
        setCode('');
        setStep('old');
        AccessibilityInfo.announceForAccessibility(`Codes sent to ${current} and ${next}.`);
      },
    );
  }

  /** Checks a code against the address it went to: the old one's first, then the new one's, which makes the change. */
  function verify(typed: string) {
    if (!isValidCode(typed)) return;
    const email = step === 'old' ? current : next;
    run(
      () => supabase.auth.verifyOtp({ email, token: typed.trim(), type: 'email_change' }),
      () => {
        setCode('');
        if (step === 'old') return setStep('new');
        Alert.alert('Email changed', `Kept now uses ${next}. Sign in with it from now on.`, [{ text: 'OK', onPress: () => router.back() }]);
      },
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      <PageTitle title="Change email" />
      {step === 'address' ? (
        <>
          <Text style={styles.hint}>Now {current}. Kept sends a code to this address and to the new one, and the change needs both.</Text>
          <Field label="New email">
            <TextInput
              style={bareInputStyle(colors)}
              placeholder="name@example.com"
              placeholderTextColor={PLACEHOLDER_COLOR}
              accessibilityLabel="New email"
              value={address}
              onChangeText={(text) => {
                setAddress(text);
                setError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={sendCodes}
              autoFocus
            />
          </Field>
          <ErrorText message={error} />
          <Button title={busy ? 'Sending…' : 'Send codes'} onPress={sendCodes} disabled={busy} />
        </>
      ) : (
        <>
          <Text style={styles.hint}>
            {step === 'old' ? `Step 1 of 2: the ${OTP_LENGTH}-digit code sent to ${current}, your email now.` : `Step 2 of 2: the ${OTP_LENGTH}-digit code sent to ${next}.`}{' '}
            {CODE_LIFETIME}.
          </Text>
          {/* A new box for each step, so it takes the focus again. */}
          <CodeInput
            key={step}
            value={code}
            onChangeCode={(typed) => {
              setCode(typed);
              setError(null);
              verify(typed);
            }}
          />
          <ErrorText message={error} />
          <Button title={busy ? 'Sending…' : 'Send new codes'} onPress={sendCodes} disabled={busy} variant="link" />
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: { ...COLUMN, padding: SPACE.lg, gap: SPACE.md },
    hint: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
  });
