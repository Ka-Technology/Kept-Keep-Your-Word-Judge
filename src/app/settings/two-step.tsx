// Settings → Privacy & security → Two-step verification (T161): optional, for real money. Turning it on makes an
// authenticator factor (Supabase TOTP): Add to your authenticator app opens it on the key (an otpauth: link, which
// Passwords, Google Authenticator, 1Password and others take), with the key to copy and a QR code for an app on
// another device; the first 6-digit code confirms it. Two short pages, so the keyboard never covers the key: first
// add Kept to the app, then type the code, with nothing else on the page. From then on, signing in asks for a code (app/two-step.tsx).
// Turning it off removes the factor; it needs this session to have given its code, which signing in did.

import { useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '@/components/button';
import { CodeInput, PasteCodeButton } from '@/components/code-input';
import { ListRow, ListScreen, ListSection } from '@/components/list';
import { PageTitle } from '@/components/tab-title';
import { isValidCode } from '@/lib/auth-state';
import { supabase } from '@/lib/supabase';
import { SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';
import { twoStepErrorMessage } from '@/lib/two-step';
import { must, useFocusLoad } from '@/lib/use-focus-load';

type Setup = { factorId: string; uri: string; secret: string };

export default function TwoStepSettings() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { data: factorId, reload } = useFocusLoad(async () => {
    const { totp } = must(await supabase.auth.mfa.listFactors()) as { totp: { id: string }[] };
    return totp[0]?.id ?? '';
  });
  const [setup, setSetup] = useState<Setup | null>(null);
  const [page, setPage] = useState<'add' | 'code'>('add');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = !!factorId;

  async function start() {
    setBusy(true);
    setError(null);
    // A setup left unfinished before can't be finished now: it goes first.
    const { data: all } = await supabase.auth.mfa.listFactors();
    for (const f of all?.all ?? []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    // The issuer is the name the authenticator app shows; without it Supabase uses the project's site URL.
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app', issuer: 'Kept' });
    setBusy(false);
    if (enrollError || !data) return setError(twoStepErrorMessage(enrollError ?? {}));
    setPage('add');
    setSetup({ factorId: data.id, uri: data.totp.uri, secret: data.totp.secret });
  }

  async function confirm(next: string) {
    if (!setup || !isValidCode(next) || busy) return;
    setBusy(true);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: setup.factorId, code: next });
    setBusy(false);
    if (verifyError) return setError(twoStepErrorMessage(verifyError));
    setSetup(null);
    setCode('');
    reload();
    Alert.alert('Two-step verification is on', 'From now on, signing in asks for a code from your authenticator app.');
  }

  function turnOff() {
    Alert.alert('Turn off two-step verification?', 'Signing in will take only your password again.', [
      { text: 'Keep it on', style: 'cancel' },
      {
        text: 'Turn off',
        style: 'destructive',
        onPress: async () => {
          const { error: offError } = await supabase.auth.mfa.unenroll({ factorId: factorId! });
          if (offError) return Alert.alert('Couldn’t turn it off', twoStepErrorMessage(offError));
          await supabase.auth.refreshSession();
          reload();
        },
      },
    ]);
  }

  return (
    <ListScreen>
      <PageTitle title="Two-step verification" />
      <ListSection
        footer={
          on
            ? 'Signing in asks for a code from your authenticator app. Lost it? The sign-in screen can email you a code to turn this off.'
            : 'After your password, signing in also asks for a 6-digit code from an authenticator app, so your money stays yours even if someone learns your password.'
        }
      >
        <ListRow label={factorId === null ? 'Loading…' : on ? 'On' : 'Off'} icon={{ ios: 'lock.shield', android: 'shield_lock' }} first />
      </ListSection>

      {on && <Button title="Turn off" onPress={turnOff} variant="destructiveLink" />}
      {!on && !setup && factorId !== null && <Button title={busy ? 'Setting up…' : 'Turn on'} onPress={start} disabled={busy} />}

      {setup && page === 'add' && (
        <View style={styles.setup}>
          <Text style={styles.step}>Step 1 of 2: Add Kept to your authenticator app.</Text>
          <Button title="Add to your authenticator app" onPress={() => Linking.openURL(setup.uri).catch(() => setError('No authenticator app opened. Copy the key below into one instead.'))} variant="secondary" />
          <Text style={styles.note}>Or enter this key in it:</Text>
          <Text style={styles.secret} selectable accessibilityLabel={`Key: ${setup.secret.split('').join(' ')}`}>
            {setup.secret}
          </Text>
          <Text style={styles.note}>Or scan this with an authenticator app on another device:</Text>
          <View style={styles.qr} accessible accessibilityLabel="QR code of the key">
            <QRCode value={setup.uri} size={160} color={colors.text} backgroundColor={colors.card} />
          </View>
          <Button title="Next: enter the code" onPress={() => { setError(null); setPage('code'); }} />
          <Button title="Cancel" onPress={() => { setSetup(null); setCode(''); setError(null); }} variant="link" />
        </View>
      )}
      {setup && page === 'code' && (
        <View style={styles.setup}>
          <Text style={styles.step}>Step 2 of 2: Enter the 6-digit code.</Text>
          <Text style={styles.note}>Open your authenticator app and find Kept. The code changes every 30 seconds, so type the one it shows now.</Text>
          <CodeInput
            value={code}
            onChangeCode={(next) => {
              setCode(next);
              setError(null);
              confirm(next);
            }}
          />
          <PasteCodeButton
            onCode={(next) => {
              setCode(next);
              setError(null);
              confirm(next);
            }}
          />
          <Button title={busy ? 'Checking…' : 'Turn on'} onPress={() => confirm(code)} disabled={!isValidCode(code) || busy} />
          <Button title="Back" onPress={() => { setError(null); setPage('add'); }} variant="link" disabled={busy} />
        </View>
      )}
      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </ListScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    setup: { gap: SPACE.md },
    step: { ...TEXT.row, color: c.text },
    note: { ...TEXT.note, color: c.secondaryText },
    secret: { ...TEXT.row, color: c.text, letterSpacing: 1 },
    qr: { alignSelf: 'center', padding: SPACE.md, backgroundColor: c.card, borderRadius: 12 },
    error: { ...TEXT.note, color: c.error },
  });
