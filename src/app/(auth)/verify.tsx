// Verify screen: enter the 6-digit code Supabase emailed after sign-up or a password-reset request,
// or ask for a new one. Opened with the address as a route parameter:
// router.push({ pathname: '/verify', params: { email } }), plus `mode: 'recovery'` for a reset.
// A correct code signs the user in, and the route guards move them on (complete-profile or reset-password).
// As in the A3 mockup since T116 (full-set/sheet-auth.jpg "verify"): "Check your email" in a card with
// an envelope, the six boxes, "Send a new code" beside how long codes last, and Verify.

import type { AuthError } from '@supabase/supabase-js';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { Button } from '@/components/button';
import { CodeInput, PasteCodeButton } from '@/components/code-input';
import { authErrorMessage, CODE_LIFETIME, isValidCode, OTP_LENGTH, RECOVERY_SENT_MESSAGE, signUpErrorMessage } from '@/lib/auth-state';
import { supabase } from '@/lib/supabase';
import { ICON, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';

const RESENT_MESSAGE = 'We sent a new code.';

/** Code entry for confirming a new account's email, or for a password reset. */
export default function Verify() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { email, mode } = useLocalSearchParams<{ email?: string; mode?: string }>();
  const recovery = mode === 'recovery';
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [busy, setBusy] = useState<'verifying' | 'resending' | null>(null);
  // Read synchronously, so a double tap can't send two requests.
  const inFlight = useRef(false);

  // Without an address there's nothing to verify (e.g. an old link), so go back to sign-in.
  if (!email) return <Redirect href="/sign-in" />;
  const address = email;

  /** Shows a message under the code box (red for errors, green otherwise) and reads it out to VoiceOver users. */
  function show(text: string, isError: boolean) {
    setMessage({ text, isError });
    AccessibilityInfo.announceForAccessibility(text);
  }

  /**
   * Runs one request to Supabase at a time: marks the screen busy, shows a plain-sentence error if
   * it fails, and calls `onSuccess` if it works.
   */
  async function run(
    kind: 'verifying' | 'resending',
    request: () => Promise<{ error: AuthError | null }>,
    onSuccess?: () => void,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    setMessage(null);
    try {
      const { error } = await request();
      if (error) show(kind === 'resending' ? signUpErrorMessage(error) : authErrorMessage(error), true);
      else onSuccess?.();
    } catch {
      show(authErrorMessage({}), true);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  /** Checks the code with Supabase. Runs by itself once the last digit is in; Continue runs it again. */
  function verify(entered: string) {
    if (!isValidCode(entered) || busy !== null) return;
    // On success the new session moves the auth guard on; nothing to navigate here.
    run('verifying', () =>
      supabase.auth.verifyOtp({ email: address, token: entered, type: recovery ? 'recovery' : 'email' }),
    );
  }

  /** Asks Supabase to email a new code (Supabase limits how often). */
  function resend() {
    run(
      'resending',
      () => (recovery ? supabase.auth.resetPasswordForEmail(address) : supabase.auth.resend({ type: 'signup', email: address })),
      () => show(recovery ? RECOVERY_SENT_MESSAGE : RESENT_MESSAGE, false),
    );
  }

  return (
    <AuthScreen
      title="Check your email"
      subtitle={
        recovery
          ? `${RECOVERY_SENT_MESSAGE} Enter it to reset the password for ${address}.`
          : `We sent a ${OTP_LENGTH}-digit code to ${address}.`
      }
      icon={<SymbolView name={{ ios: 'envelope', android: 'mail' }} size={ICON.hero} tintColor={colors.text} />}
      boxed
    >
      <CodeInput
        value={code}
        onChangeCode={(next) => {
          setCode(next);
          setMessage(null);
          verify(next);
        }}
      />
      <PasteCodeButton
        onCode={(next) => {
          setCode(next);
          setMessage(null);
          verify(next);
        }}
      />
      {message && (
        <Text style={message.isError ? styles.error : styles.notice} accessibilityRole="alert">
          {message.text}
        </Text>
      )}
      <View style={styles.resendRow}>
        <Pressable onPress={resend} disabled={busy !== null} accessibilityRole="button" hitSlop={12} style={({ pressed }) => pressed && styles.pressed}>
          <Text style={[styles.resend, busy !== null && styles.disabled]}>{busy === 'resending' ? 'Sending…' : 'Send a new code'}</Text>
        </Pressable>
        <Text style={styles.expiry}>{CODE_LIFETIME}</Text>
      </View>
      <Button
        title={busy === 'verifying' ? 'Checking…' : 'Verify'}
        onPress={() => verify(code)}
        disabled={!isValidCode(code) || busy !== null}
      />
      <Text style={styles.hint}>No email? Check your spam folder or send a new code.</Text>
      <Button title="Back to sign in" onPress={() => router.dismissTo('/sign-in')} variant="link" />
    </AuthScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    error: { ...TEXT.note, color: c.error },
    notice: { ...TEXT.note, color: c.success },
    hint: { ...TEXT.note, textAlign: 'center', color: c.secondaryText },
    resendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md, minHeight: 44 },
    resend: { ...TEXT.body, color: c.link, fontWeight: '600' },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.6 },
    expiry: { ...TEXT.caption, color: c.secondaryText },
  });
