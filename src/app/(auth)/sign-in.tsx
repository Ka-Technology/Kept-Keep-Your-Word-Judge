// Sign-in screen (as in the A3 mockup since T114, ui-auth-1-sign-in.jpg): where signed-out users land,
// "Welcome back" under Kept's K stamp. Continue with Apple (T10) and Google (T12) lead, at
// equal weight, with their agreement line (T97); then email or username (T147) and password, a "Sign in with Face ID"
// switch (T38) and Sign in, and links to forgot-password and sign-up. Turning the switch on takes a scan; with it on, a password sign-in
// saves Face ID sign-in, and from then on the scan starts by itself whenever this screen opens.
// Signing out turns it off (plan.md decision 85); the 30-day sign-out (T87) keeps it, so the scan starts.
// After a successful sign-in the route guards in app/_layout.tsx move the user on by themselves.

import * as AppleAuthentication from 'expo-apple-authentication';
import { router, useIsFocused } from 'expo-router';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, useColorScheme, View, type TextInputInstance } from 'react-native';

import { Agreement } from '@/components/agreement';
import { AuthScreen, EmailInput } from '@/components/auth-screen';
import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { GoogleButton } from '@/components/google-button';
import { PasswordInput } from '@/components/password-input';
import { SwitchRow } from '@/components/switch-row';
import { Tile } from '@/components/tile';
import { signInWithApple, useAppleSignInAvailable } from '@/lib/apple-sign-in';
import { google, signInWithGoogle } from '@/lib/google-sign-in';
import { authErrorMessage, signInName } from '@/lib/auth-state';
import { confirmWithBiometrics, deviceQuickSignIn, useQuickSignIn } from '@/lib/quick-sign-in';
import { supabase } from '@/lib/supabase';
import { RADIUS, SPACE, TEXT, useStyles, type Colors } from '@/lib/theme';
import { signInWithUsername } from '@/lib/username-sign-in';

/** Email or username + password sign-in, Face ID, and Sign in with Apple and Google. */
export default function SignIn() {
  const styles = useStyles(makeStyles);
  // The email or the username (T147).
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nameChecked, setNameChecked] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);
  const quick = useQuickSignIn();
  // The switch: on once Face ID sign-in is saved, or once the user turns it on here; never preselected.
  const [wantBiometrics, setWantBiometrics] = useState(false);
  const useBiometrics = quick.choice === 'on' || wantBiometrics;
  const appleAvailable = useAppleSignInAvailable();
  const dark = useColorScheme() === 'dark';
  // Read synchronously, so a Return-key press and a button tap in the same frame can't both submit.
  const inFlight = useRef(false);

  const parsed = signInName(name);
  const nameError = nameChecked && name.trim() !== '' && 'error' in parsed ? parsed.error : null;
  const canSubmit = name.trim() !== '' && password !== '' && !submitting;
  // Forgot password starts from the email, if that's what's typed.
  const typedEmail = 'email' in parsed ? parsed.email : '';

  /** Checks the box holds an email or a possible username (on leaving it and on submit). */
  function checkName() {
    setNameChecked(true);
    if ('error' in parsed && name.trim() !== '') AccessibilityInfo.announceForAccessibility(parsed.error);
    return !('error' in parsed);
  }

  /** Shows an error under the form and reads it out to VoiceOver users. */
  function showError(message: string) {
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
  }

  /** Runs one sign-in at a time, showing "Signing in…" meanwhile. */
  async function attempt(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await task();
    } catch {
      showError(authErrorMessage({}));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  /**
   * Sends the sign-in to Supabase. Success needs no navigation: the new session changes the auth
   * state. With the switch on, it saves (or refreshes) the Face ID sign-in through the module, since
   * this screen is gone by the time the save finishes.
   */
  async function signIn() {
    if (!canSubmit) return;
    setError(null);
    if (!checkName()) return;

    await attempt(async () => {
      // A username goes through the sign-in function (T147); Face ID then saves the account's email.
      if ('username' in parsed) {
        const result = await signInWithUsername(parsed.username, password);
        if (result.error) showError(authErrorMessage(result.error));
        else if (useBiometrics && result.email) deviceQuickSignIn.turnOn({ email: result.email, password }).catch(() => {});
        return;
      }
      if (!('email' in parsed)) return;
      const credentials = { email: parsed.email, password };
      const { error } = await supabase.auth.signInWithPassword(credentials);
      // Signed up but never entered the code: send them where they can (and can ask for a new one).
      if (error?.code === 'email_not_confirmed') router.push({ pathname: '/verify', params: { email: parsed.email } });
      else if (error) showError(authErrorMessage(error));
      else if (useBiometrics) deviceQuickSignIn.turnOn(credentials).catch(() => {});
    });
  }

  /**
   * Turning the switch on takes one scan first (owner, 2026-09-30); it then saves the sign-in at the
   * next password sign-in. Turning it off forgets the saved sign-in at once.
   */
  async function setBiometrics(on: boolean) {
    if (on) {
      if (quick.name && (await confirmWithBiometrics(quick.name))) setWantBiometrics(true);
      return;
    }
    setWantBiometrics(false);
    if (quick.choice === 'on') deviceQuickSignIn.turnOff().finally(quick.refresh);
  }

  /** One scan, no typing. A cancelled scan just leaves the form; a stale saved sign-in is deleted. */
  const signInWithBiometrics = useEffectEvent(() => {
    attempt(async () => {
      const result = await deviceQuickSignIn.signIn((c) => supabase.auth.signInWithPassword(c));
      if (result.kind === 'forgotten') {
        if (result.email) setName(result.email);
        quick.refresh();
        showError('Your saved sign-in no longer works. Enter your password once to sign in.');
        passwordRef.current?.focus();
      } else if (result.kind === 'error') {
        showError(authErrorMessage(result.error));
      }
    });
  });

  // With Face ID sign-in saved, the scan starts by itself each time this screen comes into view.
  const focused = useIsFocused();
  const scanOnFocus = quick.name !== null && quick.choice === 'on';
  useEffect(() => {
    if (focused && scanOnFocus) signInWithBiometrics();
  }, [focused, scanOnFocus]);

  /** Apple's sheet, then Supabase. Closing the sheet shows nothing; a first-time user goes on to complete their profile. */
  function appleSignIn() {
    attempt(async () => {
      const result = await signInWithApple();
      if (typeof result === 'object') showError(authErrorMessage(result.error));
    });
  }

  /** Google's sheet, then Supabase. Closing the sheet shows nothing; a first-time user goes on to complete their profile. */
  function googleSignIn() {
    attempt(async () => {
      const result = await signInWithGoogle();
      if (typeof result === 'object') showError(authErrorMessage(result.error));
    });
  }

  return (
    <AuthScreen title="Welcome back" large>
      {/* Apple and Google lead, at equal weight (T97); email and password follow. */}
      {(appleAvailable || google) && (
        <>
          {appleAvailable && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              // A pill, as in the mockup: half the button's height.
              cornerRadius={PROVIDER_HEIGHT / 2}
              style={styles.provider}
              onPress={appleSignIn}
            />
          )}
          {google && (
            <GoogleButton height={PROVIDER_HEIGHT} onPress={googleSignIn} disabled={submitting} />
          )}
          <Agreement />
          <View style={styles.divider} accessible accessibilityLabel="Or sign in with your email or username">
            <View style={styles.line} />
            <Text style={styles.or}>or</Text>
            <View style={styles.line} />
          </View>
        </>
      )}
      <EmailInput
        placeholder="Email or username"
        accessibilityLabel="Email or username"
        // The sign-in name for iOS Passwords: a saved email fills in here, and a username works too.
        autoComplete="username"
        textContentType="username"
        value={name}
        onChangeText={setName}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
        onBlur={checkName}
      />
      <ErrorText message={nameError} />
      <PasswordInput
        ref={passwordRef}
        placeholder="Password"
        accessibilityLabel="Password"
        value={password}
        onChangeText={setPassword}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={signIn}
      />
      {quick.name && (
        <SwitchRow
          label={`Use ${quick.name} next time`}
          icon={quick.name === 'Face ID' ? { ios: 'faceid', android: 'face' } : { ios: 'touchid', android: 'fingerprint' }}
          value={useBiometrics}
          onValueChange={setBiometrics}
        />
      )}
      <ErrorText message={error} />
      <Button title={submitting ? 'Signing in…' : 'Sign in'} onPress={signIn} disabled={!canSubmit} />
      <Button
        title="Forgot password?"
        onPress={() => router.push({ pathname: '/forgot-password', params: { email: typedEmail } })}
        variant="link"
      />
      <Tile
        style={styles.newCard}
        onPress={() => router.push('/sign-up')}
        accessibilityLabel="New to Kept? Create an account"
      >
        <Text style={styles.newText}>
          New to Kept? <Text style={styles.newLink}>Create an account</Text>
        </Text>
      </Tile>
    </AuthScreen>
  );
}

/** Apple's and Google's buttons, 50 pt tall. */
const PROVIDER_HEIGHT = 50;

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    provider: { height: PROVIDER_HEIGHT },
    divider: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginVertical: SPACE.xs },
    line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.separator },
    or: { ...TEXT.note, color: c.secondaryText },
    newCard: {
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: SPACE.lg,
      paddingVertical: SPACE.md,
      borderRadius: RADIUS.card,
    },
    newText: { ...TEXT.body, color: c.secondaryText, textAlign: 'center' },
    newLink: { color: c.link, fontWeight: '600' },
  });
