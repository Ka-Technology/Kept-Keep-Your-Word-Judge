// The authenticator code at sign-in (T161): after the password (or Apple or Google), an account with two-step
// verification on stops here until its 6-digit code is given (auth-state 'two-step'), then goes on as usual.
// Lost the app: an email code (`two-step-recover`) turns two-step off, so the password alone signs in, and it can be
// turned on again in Settings → Privacy & security. Sign out leaves without either.

import { FunctionsHttpError } from '@supabase/supabase-js';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { Button } from '@/components/button';
import { CodeInput, PasteCodeButton } from '@/components/code-input';
import { useAuth } from '@/lib/auth';
import { isValidCode } from '@/lib/auth-state';
import { supabase } from '@/lib/supabase';
import { ICON, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';
import { recoverySendMessage, twoStepErrorMessage } from '@/lib/two-step';

export default function TwoStep() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { signOut } = useAuth();
  const [code, setCode] = useState('');
  // Recovering by email: the code sent, waiting for it.
  const [recovering, setRecovering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  async function verify(next: string) {
    if (!isValidCode(next) || busy) return;
    setBusy(true);
    try {
      if (recovering) {
        const { data, error } = await supabase.functions.invoke('two-step-recover', { body: { action: 'verify', code: next } });
        if (error || !data?.done) {
          const answer = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
          return setMessage({ text: twoStepErrorMessage({ code: answer?.error ?? (error ? undefined : 'unknown') }), isError: true });
        }
        // The authenticator is gone: a fresh token says so, and the app goes on.
        await supabase.auth.refreshSession();
        return;
      }
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp[0];
      if (listError || !factor) return setMessage({ text: twoStepErrorMessage({}), isError: true });
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: next });
      if (error) setMessage({ text: twoStepErrorMessage(error), isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function sendRecovery() {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.functions.invoke('two-step-recover', { body: { action: 'send' } });
    setBusy(false);
    const refusal = error instanceof FunctionsHttpError ? (await error.context.json().catch(() => null))?.error : undefined;
    // Asked again within the minute: the code already sent still works, so its screen opens.
    if (error && refusal !== 'wait_a_minute') return setMessage({ text: recoverySendMessage(refusal), isError: true });
    setRecovering(true);
    setCode('');
    setMessage({ text: error ? recoverySendMessage(refusal) : 'We emailed you a code. Enter it to turn two-step verification off.', isError: false });
  }

  return (
    <AuthScreen
      title={recovering ? 'Check your email' : 'Two-step verification'}
      subtitle={recovering ? 'Enter the code we emailed you. It lasts 15 minutes.' : 'Enter the 6-digit code from your authenticator app.'}
      icon={<SymbolView name={{ ios: recovering ? 'envelope' : 'lock.shield', android: recovering ? 'mail' : 'shield_lock' }} size={ICON.hero} tintColor={colors.text} />}
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
      <Button title={busy ? 'Checking…' : 'Verify'} onPress={() => verify(code)} disabled={!isValidCode(code) || busy} />
      {!recovering && <Button title="Lost your authenticator app?" onPress={sendRecovery} variant="link" disabled={busy} />}
      {/* Signing out lands on sign-in by itself: the guards follow the session. */}
      <Button title="Sign out" onPress={signOut} variant="link" />
    </AuthScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    error: { ...TEXT.note, color: c.error },
    notice: { ...TEXT.note, color: c.success },
  });
