// Send feedback (T158; SPEC-app-shell.md, "Feedback"), opened from Settings → About: a bug, an idea,
// a habit Kept should add, or anything else, with an optional photo or screenshot. The app adds its
// version and iOS's; the database pushes and emails the owner (0053, notify), who replies by email.
// Nobody else reads it. Built on the Report screen's layout (report.tsx).

import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { ListScreen } from '@/components/list';
import { Segmented } from '@/components/segmented';
import { PageTitle } from '@/components/tab-title';
import { Tile } from '@/components/tile';
import { useAuth } from '@/lib/auth';
import { FEEDBACK_KINDS, FEEDBACK_MAX, feedbackErrorMessage, feedbackPhotoPath, feedbackProblem, type FeedbackKind } from '@/lib/feedback';
import { pickFeedbackPhoto, uploadFeedbackPhoto } from '@/lib/feedback-photos';
import { supabase } from '@/lib/supabase';
import { ICON, inputStyle, PLACEHOLDER_COLOR, RADIUS, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';

export default function Feedback() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { session } = useAuth();
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [message, setMessage] = useState('');
  const [photo, setPhoto] = useState<{ base64: string; uri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Read synchronously, so a double tap can't send it twice.
  const inFlight = useRef(false);

  const placeholder = FEEDBACK_KINDS.find((k) => k.value === kind)?.placeholder ?? 'Pick what it’s about, then tell us.';

  function showError(text: string) {
    setError(text);
    AccessibilityInfo.announceForAccessibility(text);
  }

  async function addPhoto() {
    try {
      const picked = await pickFeedbackPhoto();
      if (picked) setPhoto(picked);
    } catch {
      showError('Couldn’t open your photos. Try again, or send it without one.');
    }
  }

  async function send() {
    if (!session || feedbackProblem(kind, message) || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      const photoPath = photo ? feedbackPhotoPath(session.user.id, Crypto.randomUUID()) : null;
      if (photo && photoPath) await uploadFeedbackPhoto(photoPath, photo.base64);
      const { error } = await supabase.from('feedback').insert({
        kind,
        message: message.trim(),
        photo_path: photoPath,
        app_version: Constants.expoConfig?.version ?? null,
        os: Platform.OS,
        os_version: String(Platform.Version),
      });
      if (error) throw error;
    } catch (e) {
      return showError(feedbackErrorMessage(e as { code?: string; message?: string }));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
    Alert.alert('Thanks for telling us', 'We read every message, and reply by email when there’s something to say.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  return (
    <ListScreen>
      <Stack.Screen
        options={{
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close" hitSlop={SPACE.md}>
              <SymbolView name={{ ios: 'xmark', android: 'close' }} size={ICON.row} tintColor={colors.text} />
            </Pressable>
          ),
        }}
      />
      <PageTitle title="Send feedback" subtitle="A bug, an idea, or a habit you want to track? Tell us." />
      <Segmented options={FEEDBACK_KINDS} value={kind} onChange={setKind} label="What it’s about" look="chips" />
      <Tile style={styles.noteCard}>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={PLACEHOLDER_COLOR}
          accessibilityLabel="Your message"
          value={message}
          onChangeText={setMessage}
          maxLength={FEEDBACK_MAX}
          multiline
        />
      </Tile>
      {photo ? (
        <View style={styles.photoRow}>
          <Image source={{ uri: photo.uri }} style={styles.photo} accessibilityLabel="The photo you attached" />
          <Button title="Remove photo" variant="destructiveLink" onPress={() => setPhoto(null)} />
        </View>
      ) : (
        <Button title="Add a photo or screenshot" variant="secondary" onPress={addPhoto} />
      )}
      <Text style={styles.small}>Kept adds the app’s version and iOS’s. A person reads every message.</Text>
      <ErrorText message={error} />
      <Button title={sending ? 'Sending…' : 'Send feedback'} onPress={send} disabled={!!feedbackProblem(kind, message) || sending} />
    </ListScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    noteCard: { padding: SPACE.lg },
    input: { ...inputStyle(c), minHeight: 140, textAlignVertical: 'top' },
    photoRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.lg },
    photo: { width: 72, height: 72, borderRadius: RADIUS.field, backgroundColor: c.track },
    small: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
  });
