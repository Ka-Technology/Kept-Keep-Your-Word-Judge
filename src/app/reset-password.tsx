// Reset-password screen: the only screen after a password-reset code signs the user in (the
// `recovering` auth state). Saving the new password ends recovery, and the route guards move the
// user on to Home (or complete-profile). Cancel signs out, leaving the old password in place. As in
// the A3 mockup since T118 (full-set/sheet-auth.jpg "reset"): Kept's stamp beside the title, the
// "New password" card with its rules, the confirm card (a real rule the mockup leaves out), Save.

import { useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { DayStamp } from '@/components/big-stamp';
import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { NewPasswordFields } from '@/components/new-password-fields';
import { useAuth } from '@/lib/auth';
import { authErrorMessage, isStrongPassword, LEAKED_PASSWORD_MESSAGE, PASSWORD_MISMATCH_MESSAGE, PASSWORD_RULE_MESSAGE } from '@/lib/auth-state';
import { isLeakedPassword } from '@/lib/leaked-password';
import { supabase } from '@/lib/supabase';
import { useColors } from '@/lib/theme';

/** New password + confirm, checked against the same rules as sign-up. */
export default function ResetPassword() {
  const colors = useColors();
  const { signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Read synchronously, so a double tap can't send two requests.
  const inFlight = useRef(false);

  /** Shows an error under the form and reads it out to VoiceOver users. */
  function showError(message: string) {
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
  }

  /** Saves the new password. Success needs no navigation: Supabase's USER_UPDATED event ends recovery. */
  async function save() {
    if (inFlight.current) return;
    setAttempted(true);
    setError(null);
    if (!isStrongPassword(password) || confirm !== password) {
      AccessibilityInfo.announceForAccessibility(isStrongPassword(password) ? PASSWORD_MISMATCH_MESSAGE : PASSWORD_RULE_MESSAGE);
      return;
    }

    inFlight.current = true;
    setSaving(true);
    try {
      // A password from a known data breach is refused (leaked-password.ts).
      if (await isLeakedPassword(password)) return showError(LEAKED_PASSWORD_MESSAGE);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) showError(authErrorMessage(error));
    } catch {
      showError(authErrorMessage({}));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <AuthScreen title="Choose a new password" icon={<DayStamp kind="kept" color={colors.stamp} size={34} />}>
      <NewPasswordFields
        label="New password"
        password={password}
        confirm={confirm}
        onChangePassword={setPassword}
        onChangeConfirm={setConfirm}
        showErrors={attempted}
      />
      <ErrorText message={error} />
      <Button title={saving ? 'Saving…' : 'Save password'} onPress={save} disabled={saving} />
      <Button title="Cancel" onPress={signOut} disabled={saving} variant="destructiveLink" />
    </AuthScreen>
  );
}
