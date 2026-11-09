// Complete-profile screen: shown once to every new account, whatever the sign-in method, until it
// has a profile. Saving the profile moves the user on to Home (the route guards follow the auth state).
// After an email sign-up it saves the details typed on the sign-up form straight away; the form
// only appears if that fails (e.g. the username was taken meanwhile) or there are no such details,
// as after Apple or Google. Either way the profile is saved with the answer for Kept's AI (decision 96).
// As in the A3 mockup since T119 (full-set/sheet-auth.jpg "complete profile"): "Almost there", the
// profile's field cards with icons, the AI choice, the 18+ tick box (decision 99), Continue.

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, StyleSheet, Text, View } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { KeptMark } from '@/components/kept-mark';
import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { ProfileFields } from '@/components/profile-fields';
import { useAuth } from '@/lib/auth';
import { deleteAccount as deleteEverything } from '@/lib/delete-account';
import {
  ADULT_MESSAGE,
  isAdult,
  profileErrors,
  profileSaveMessage,
  profileSaveResult,
  toDateString,
  type ProfileInput,
  type ProfileSaveResult,
} from '@/lib/profile';
import { clearProfileDraft, peekProfileDraft, type ProfileDraft } from '@/lib/profile-draft';
import { supabase } from '@/lib/supabase';
import { SPACE, TEXT, useStyles, type Colors } from '@/lib/theme';


/** Inserts the user's profile row and says how it went (see ProfileSaveResult). */
async function insertProfile(userId: string, details: ProfileDraft): Promise<ProfileSaveResult> {
  try {
    const { error } = await supabase.from('profiles').insert({
      id: userId,
      first_name: details.firstName,
      last_name: details.lastName,
      username: details.username,
      date_of_birth: toDateString(details.dob),
      state_code: details.stateCode,
      ai_allowed: details.aiAllowed,
    });
    return profileSaveResult(error);
  } catch {
    return 'offline';
  }
}

/** The profile form: name, username, date of birth, state and the AI answer. */
export default function CompleteProfile() {
  const styles = useStyles(makeStyles);
  const { session, signOut, reloadProfile } = useAuth();
  // Details typed on the sign-up form, if this account was just created with them.
  const [draft] = useState(() => peekProfileDraft(session?.user.email));
  const [input, setInput] = useState<ProfileInput>(
    // Sign-up's details were ticked there already.
    draft ? { ...draft, agreed: true } : { firstName: '', lastName: '', username: '', dob: null, stateCode: null, aiAllowed: null, agreed: false },
  );
  const [autoSaving, setAutoSaving] = useState(draft !== null);
  // Field errors show only after the first save attempt, then update as the user fixes them.
  const [attempted, setAttempted] = useState(false);
  // A username the database refused, and why; shown under the field until the username changes.
  const [usernameProblem, setUsernameProblem] = useState<{ username: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Read synchronously, so a double tap can't send two requests.
  const inFlight = useRef(false);
  const userId = session?.user.id;

  const fieldErrors = attempted ? profileErrors(input) : {};
  const errors =
    usernameProblem?.username === input.username ? { ...fieldErrors, username: usernameProblem.message } : fieldErrors;

  /** Shows an error under the form and reads it out to VoiceOver users. */
  function showError(message: string) {
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
  }

  /** Deletes the account (the profile would go with it) and signs out, which returns to sign-in. */
  async function deleteAccount() {
    try {
      if (!session) throw new Error('signed out');
      await deleteEverything(session);
    } catch {
      return showError("Couldn't delete the account. Check your connection and try again.");
    }
    await signOut();
  }

  /** Kept is 18+ only. A mis-scrolled date shouldn't delete an account, so ask before deleting it. */
  function confirmUnderage() {
    Alert.alert(ADULT_MESSAGE, "If your date of birth is right, we'll delete this account.", [
      { text: 'Fix the date', style: 'cancel' },
      { text: 'Delete account', style: 'destructive', onPress: deleteAccount },
    ]);
  }

  /** Moves on to Home after a save, or explains on the form why it didn't work. */
  function handleSaveResult(result: ProfileSaveResult, username: string) {
    if (result === 'saved') {
      // The new profile makes the auth state 'ready', and the guards open Home. Not refreshProfile(): its loading
      // screen would take the navigator down while this screen is still sliding in (a black screen, 2026-11-06).
      clearProfileDraft();
      reloadProfile();
    } else if (result === 'username-taken' || result === 'username-invalid' || result === 'username-objectionable') {
      const message = profileSaveMessage(result);
      setUsernameProblem({ username, message });
      AccessibilityInfo.announceForAccessibility(message);
    } else {
      showError(profileSaveMessage(result));
    }
  }

  /** The Continue button: checks the form, then saves. Under-18s are asked to confirm, then their account is deleted. */
  async function save() {
    if (inFlight.current || !userId) return;
    setAttempted(true);
    setError(null);
    if (input.dob && !isAdult(input.dob)) return confirmUnderage();
    const problems = profileErrors(input);
    if (Object.keys(problems).length > 0) {
      AccessibilityInfo.announceForAccessibility(Object.values(problems).join(' '));
      return;
    }

    inFlight.current = true;
    setSaving(true);
    const result = await insertProfile(userId, { firstName: input.firstName.trim(), lastName: input.lastName.trim(), username: input.username, dob: input.dob!, stateCode: input.stateCode!, aiAllowed: input.aiAllowed! });
    // Saved: stays busy until the guards move on.
    if (result !== 'saved') {
      inFlight.current = false;
      setSaving(false);
    }
    handleSaveResult(result, input.username);
  }

  // Save the sign-up details once, as soon as the screen opens. Saved, it stays as it is until the
  // guards move on; otherwise the form shows why.
  const onDraftSaved = useEffectEvent((result: ProfileSaveResult, username: string) => {
    handleSaveResult(result, username);
    if (result !== 'saved') setAutoSaving(false);
  });
  useEffect(() => {
    if (!draft || !userId) return;
    let active = true;
    insertProfile(userId, draft).then((result) => {
      if (active) onDraftSaved(result, draft.username);
    });
    return () => {
      active = false;
    };
  }, [draft, userId]);

  if (autoSaving) {
    return (
      <View style={styles.center}>
        <KeptMark size={80} />
        <Text style={styles.subtitle}>Setting up your account…</Text>
      </View>
    );
  }

  return (
    <AuthScreen title="Almost there" subtitle="A few things Kept needs before your first challenge.">
      <ProfileFields
        value={input}
        onChange={(next) => {
          setInput(next);
          setError(null);
        }}
        errors={errors}
      />
      <ErrorText message={error} />
      <Button title={saving ? 'Saving…' : 'Continue'} onPress={save} disabled={saving} />
      <Button title="Sign out" onPress={signOut} variant="destructiveLink" />
    </AuthScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.md, backgroundColor: c.background },
    subtitle: { ...TEXT.body, textAlign: 'center', color: c.secondaryText },
  });
