// Forgot-password screen: asks for the account's email, has Supabase email a reset code, then opens
// verify in recovery mode. Supabase answers the same whether or not the email has an account, so the
// next screen's message can't reveal which emails are registered. As in the A3 mockup since T117
// (full-set/sheet-auth.jpg "forgot"): an envelope beside the title, the email card, Send code; the
// header's back returns to sign-in.

import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { AuthScreen, EmailInput } from '@/components/auth-screen';
import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { authErrorMessage, EMAIL_FORMAT_MESSAGE, isValidEmail } from '@/lib/auth-state';
import { supabase } from '@/lib/supabase';
import { ICON, useColors } from '@/lib/theme';

/** Email entry for a password reset. Starts with whatever was typed on sign-in. */
export default function ForgotPassword() {
  const colors = useColors();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Read synchronously, so a Return-key press and a button tap in the same frame can't both send.
  const inFlight = useRef(false);

  const canSubmit = email.trim() !== '' && !sending;

  /** Shows an error under the field and reads it out to VoiceOver users. */
  function showError(message: string) {
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
  }

  /** Asks Supabase to email a reset code, then moves on to code entry. */
  async function send() {
    if (!canSubmit || inFlight.current) return;
    setError(null);
    if (!isValidEmail(email)) return showError(EMAIL_FORMAT_MESSAGE);

    inFlight.current = true;
    setSending(true);
    try {
      const address = email.trim();
      const { error } = await supabase.auth.resetPasswordForEmail(address);
      if (error) showError(authErrorMessage(error));
      else router.push({ pathname: '/verify', params: { email: address, mode: 'recovery' } });
    } catch {
      showError(authErrorMessage({}));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <AuthScreen
      title="Reset your password"
      subtitle="Enter your email and we'll send you a code."
      icon={<SymbolView name={{ ios: 'envelope.badge', android: 'mark_email_unread' }} size={ICON.hero} tintColor={colors.text} />}
    >
      <EmailInput
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setError(null);
        }}
        returnKeyType="send"
        onSubmitEditing={send}
      />
      <ErrorText message={error} />
      <Button title={sending ? 'Sending…' : 'Send code'} onPress={send} disabled={!canSubmit} />
    </AuthScreen>
  );
}
