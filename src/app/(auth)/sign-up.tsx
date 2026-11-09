// Sign-up screen, in two steps (T97; as in the A3 mockups since T115, full-set/sheet-auth.jpg): your
// account (email and password), then about you (name, username with a live "Available", date of
// birth, state, Allow or Don't allow for Kept's AI, decision 96, and the 18+ tick box, decision 99).
// A progress bar heads both; the header's back on step 2 returns to step 1. Everything is checked
// before anything is sent, so under-18s never get an account. Supabase then emails a 6-digit code,
// and the user moves on to the verify screen. The profile details wait in memory
// (lib/profile-draft.ts) until complete-profile saves them.

import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, type TextInputInstance } from 'react-native';

import { AuthScreen, EmailInput } from '@/components/auth-screen';
import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { NewPasswordFields } from '@/components/new-password-fields';
import { ProfileFields } from '@/components/profile-fields';
import { ProgressBar } from '@/components/step-screen';
import {
  authErrorMessage,
  EMAIL_FORMAT_MESSAGE,
  EXISTING_ACCOUNT_MESSAGE,
  isExistingAccount,
  isStrongPassword,
  isValidEmail,
  LEAKED_PASSWORD_MESSAGE,
  PASSWORD_MISMATCH_MESSAGE,
  PASSWORD_RULE_MESSAGE,
  signUpErrorMessage,
} from '@/lib/auth-state';
import { isLeakedPassword } from '@/lib/leaked-password';
import { profileErrors, USERNAME_TAKEN_MESSAGE, type ProfileInput } from '@/lib/profile';
import { saveProfileDraft } from '@/lib/profile-draft';
import { supabase } from '@/lib/supabase';
import { useColors } from '@/lib/theme';

/** The sign-up form, a step at a time. Every field is checked here before anything is sent. */
export default function SignUp() {
  const colors = useColors();
  const [step, setStep] = useState<'account' | 'about'>('account');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [profile, setProfile] = useState<ProfileInput>({ firstName: '', lastName: '', username: '', dob: null, stateCode: null, aiAllowed: null, agreed: false });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [emailChecked, setEmailChecked] = useState(false);
  // Each step's errors show only after its first tap on Continue or Create account, then update as they're fixed.
  const [accountAttempted, setAccountAttempted] = useState(false);
  const [aboutAttempted, setAboutAttempted] = useState(false);
  // A username the database says is taken; shown under the field until the username changes.
  const [takenUsername, setTakenUsername] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  // Read synchronously, so a Return-key press and a button tap in the same frame can't both submit.
  const inFlight = useRef(false);

  const emailFormatError = emailChecked && email.trim() !== '' && !isValidEmail(email);
  const fieldErrors = aboutAttempted ? profileErrors(profile) : {};
  const profileFieldErrors = takenUsername === profile.username ? { ...fieldErrors, username: USERNAME_TAKEN_MESSAGE } : fieldErrors;
  const canContinue = email.trim() !== '' && password !== '' && !submitting;

  /** Checks the email format (on leaving the field and on Continue); returns whether it's valid. */
  function checkEmail() {
    setEmailChecked(true);
    const valid = isValidEmail(email);
    if (email.trim() !== '' && !valid) AccessibilityInfo.announceForAccessibility(EMAIL_FORMAT_MESSAGE);
    return valid;
  }

  /** Shows an error under the form and reads it out to VoiceOver users. */
  function showError(message: string) {
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
  }

  /** Runs one request at a time, with the button showing it's busy. */
  async function attempt(task: () => Promise<void>) {
    inFlight.current = true;
    setSubmitting(true);
    try {
      await task();
    } catch {
      showError(authErrorMessage({}));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  /** Step 1: checks the email and password, and that the password isn't from a known breach, then asks about you. */
  async function continueToAbout() {
    if (!canContinue || inFlight.current) return;
    setError(null);
    setAccountAttempted(true);
    const emailValid = checkEmail();
    const passwordValid = isStrongPassword(password) && confirm === password;
    if (!passwordValid) {
      AccessibilityInfo.announceForAccessibility(isStrongPassword(password) ? PASSWORD_MISMATCH_MESSAGE : PASSWORD_RULE_MESSAGE);
    }
    if (!emailValid || !passwordValid) return;
    await attempt(async () => {
      // Refused before any account exists (leaked-password.ts).
      if (await isLeakedPassword(password)) return showError(LEAKED_PASSWORD_MESSAGE);
      setStep('about');
    });
  }

  /** Step 2: checks the profile (an under-18 date of birth stops here), creates the account (which emails the code), then opens the verify screen. */
  async function signUp() {
    if (inFlight.current) return;
    setError(null);
    setAboutAttempted(true);
    const problems = profileErrors(profile);
    if (Object.keys(problems).length > 0) return AccessibilityInfo.announceForAccessibility(Object.values(problems).join(' '));

    await attempt(async () => {
      // Checked before the account exists, so no code is emailed for a name that's taken (0011).
      // ponytail: if the check itself fails, sign-up goes on; complete-profile still refuses a taken name.
      const { data: free } = await supabase.rpc('username_available', { name: profile.username });
      if (free === false) {
        setTakenUsername(profile.username);
        return AccessibilityInfo.announceForAccessibility(USERNAME_TAKEN_MESSAGE);
      }
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) {
        showError(signUpErrorMessage(error));
      } else if (isExistingAccount(data.user)) {
        // No code was sent; this email needs to sign in instead (decided 2026-09-24: tell people).
        showError(EXISTING_ACCOUNT_MESSAGE);
      } else {
        saveProfileDraft(email, { firstName: profile.firstName.trim(), lastName: profile.lastName.trim(), username: profile.username, dob: profile.dob!, stateCode: profile.stateCode!, aiAllowed: profile.aiAllowed! });
        router.push({ pathname: '/verify', params: { email: email.trim() } });
      }
    });
  }

  /** Step 2's back: to step 1, keeping what's typed. */
  function backToAccount() {
    setError(null);
    setStep('account');
  }

  // The header's back leaves sign-up from step 1; on step 2 it goes back a step instead (and the
  // swipe back is off there, since it would leave sign-up).
  const header = (
    <Stack.Screen
      options={{
        gestureEnabled: step === 'account',
        headerLeft:
          step === 'about'
            ? () => (
                <Pressable onPress={backToAccount} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
                  <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back' }} size={22} weight="semibold" tintColor={colors.text} />
                </Pressable>
              )
            : undefined,
      }}
    />
  );

  if (step === 'about') {
    return (
      // A new key starts the step at the top of the screen.
      <AuthScreen key="about" top={<ProgressBar step={2} count={2} />} title="About you" subtitle="Kept is for adults 18 and over.">
        {header}
        <ProfileFields value={profile} onChange={setProfile} errors={profileFieldErrors} />
        <ErrorText message={error} />
        <Button title={submitting ? 'Creating account…' : 'Create account'} onPress={signUp} disabled={submitting} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen key="account" top={<ProgressBar step={1} count={2} />} title="Create your account">
      {header}
      <EmailInput
        label="Email address"
        placeholder="you@example.com"
        value={email}
        onChangeText={setEmail}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
        onBlur={checkEmail}
      />
      <ErrorText message={emailFormatError ? EMAIL_FORMAT_MESSAGE : null} />
      <NewPasswordFields
        password={password}
        confirm={confirm}
        onChangePassword={setPassword}
        onChangeConfirm={setConfirm}
        showErrors={accountAttempted}
        passwordRef={passwordRef}
      />
      <ErrorText message={error} />
      <Button title={submitting ? 'Checking…' : 'Next'} onPress={continueToAbout} disabled={!canContinue} />
      <Button title="Already have an account? Sign in" onPress={() => router.dismissTo('/sign-in')} variant="link" />
    </AuthScreen>
  );
}
