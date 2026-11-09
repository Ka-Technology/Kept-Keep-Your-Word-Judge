// Edit-username screen, opened from Settings (T39). Same rule and "That username is taken." check as
// sign-up. Saving updates the profile everywhere and goes back to Settings. As in the A3 mockup since
// T125 (full-set/ui-push-6-edit-username.jpg): "Your username" large, the name in an "@" card with
// sign-up's live "Available", the real rule under it, Save.

import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Field } from '@/components/field';
import { UsernameAvailability } from '@/components/profile-fields';
import { PageTitle } from '@/components/tab-title';
import { useAuth } from '@/lib/auth';
import { isObjectionable, OBJECTIONABLE_MESSAGE } from '@/lib/moderation';
import { profileSaveMessage, USERNAME_RE, USERNAME_RULE_MESSAGE } from '@/lib/profile';
import { bareInputStyle, COLUMN, PLACEHOLDER_COLOR, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';

export default function EditUsername() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { profile, updateProfile } = useAuth();
  const [username, setUsername] = useState(profile?.username ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Read synchronously, so a Return-key press and a button tap in the same frame can't both save.
  const inFlight = useRef(false);

  /** Shows an error under the field and reads it out to VoiceOver users. */
  function showError(message: string) {
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
  }

  /** Checks the new username, saves it, and goes back to Settings. An unchanged name just goes back. */
  async function save() {
    if (inFlight.current) return;
    if (username === profile?.username) return router.back();
    if (!USERNAME_RE.test(username)) return showError(USERNAME_RULE_MESSAGE);
    if (isObjectionable(username)) return showError(OBJECTIONABLE_MESSAGE);

    inFlight.current = true;
    setSaving(true);
    setError(null);
    const result = await updateProfile({ username });
    inFlight.current = false;
    setSaving(false);
    if (result === 'saved') router.back();
    else showError(profileSaveMessage(result));
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      <PageTitle title="Your username" />
      <Field error={error} trailing={username !== profile?.username && <UsernameAvailability username={username} />}>
        <View style={styles.row}>
          <Text style={styles.at}>@</Text>
          <TextInput
            style={[bareInputStyle(colors), styles.input]}
            placeholder="username"
            placeholderTextColor={PLACEHOLDER_COLOR}
            accessibilityLabel="Username"
            value={username}
            onChangeText={(text) => {
              setUsername(text.toLowerCase());
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            // iOS Passwords saves the email as the sign-in name; keep it from saving the username instead.
            autoComplete="off"
            textContentType="none"
            returnKeyType="done"
            onSubmitEditing={save}
            autoFocus
          />
        </View>
      </Field>
      <Text style={styles.hint}>{USERNAME_RULE_MESSAGE} Friends see your username, and you can sign in with it.</Text>
      <Button title={saving ? 'Saving…' : 'Save'} onPress={save} disabled={saving} />
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: { ...COLUMN, padding: SPACE.lg, gap: SPACE.lg },
    row: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    at: { ...TYPE.title, color: c.text },
    input: { fontFamily: TYPE.title.fontFamily, fontSize: TYPE.title.fontSize, minHeight: 36 },
    hint: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
  });
