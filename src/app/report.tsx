// Report (T53; SPEC-friends.md, "Reports and blocks"): a person, a check-in or a public challenge,
// opened from ReportBlock. The reporter picks a reason (none is preselected) and can add a note of
// up to 500 characters. The database fills in who was reported and pushes the owner, who reviews
// it in the dashboard; nobody else can read reports, and the reported person isn't told. As in the A3
// mockup since T140 (full-set/ui-flow-7-report.jpg): "Report" large, the six real reasons as radio rows
// with icons, "Tell us more (optional)" in a card, "A person reads every report.", Send report.

import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { ListRow, ListScreen, ListSection } from '@/components/list';
import { PageTitle } from '@/components/tab-title';
import { Tile } from '@/components/tile';
import { moderationErrorMessage, REPORT_REASONS } from '@/lib/moderation';
import { supabase } from '@/lib/supabase';
import { ICON, inputStyle, PLACEHOLDER_COLOR, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';

const REASON_ICONS: Record<(typeof REPORT_REASONS)[number]['value'], SymbolViewProps['name']> = {
  nudity: { ios: 'eye.slash', android: 'visibility_off' },
  intimate_image: { ios: 'photo', android: 'image' },
  harassment: { ios: 'shield', android: 'shield' },
  hate: { ios: 'exclamationmark.bubble', android: 'report' },
  spam: { ios: 'envelope', android: 'mail' },
  other: { ios: 'ellipsis.circle', android: 'more_horiz' },
};

export default function Report() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { reportedId, checkInId, challengeId } = useLocalSearchParams<{ reportedId?: string; checkInId?: string; challengeId?: string }>();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Read synchronously, so a double tap can't send two reports.
  const inFlight = useRef(false);

  // Never a name from the link, which could make someone report the wrong person (review, 2026-10-04).
  const what = checkInId ? 'this check-in' : challengeId ? 'this challenge' : 'this person';

  async function send() {
    if (!reason || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    const { error } = await supabase.from('reports').insert({
      reported_id: reportedId ?? null,
      check_in_id: checkInId ?? null,
      challenge_id: challengeId ?? null,
      reason,
      note: note.trim() || null,
    });
    inFlight.current = false;
    setSending(false);
    if (error) {
      const message = moderationErrorMessage(error);
      setError(message);
      return AccessibilityInfo.announceForAccessibility(message);
    }
    Alert.alert('Report sent', 'Thank you. Kept usually reviews reports within a day, and removes an intimate image shared without consent within 48 hours.', [
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
      <PageTitle title="Report" subtitle={`Why are you reporting ${what}?`} />
      <ListSection footer="They aren’t told who reported them.">
        {REPORT_REASONS.map((r, i) => (
          <ListRow key={r.value} label={r.label} icon={REASON_ICONS[r.value]} selected={reason === r.value} onPress={() => setReason(r.value)} first={i === 0} />
        ))}
      </ListSection>
      <Tile style={styles.noteCard}>
        <TextInput
          style={styles.input}
          placeholder="Tell us more (optional)"
          placeholderTextColor={PLACEHOLDER_COLOR}
          accessibilityLabel="Note for Kept, optional"
          value={note}
          onChangeText={setNote}
          maxLength={500}
          multiline
        />
      </Tile>
      <Text style={styles.small}>A person reads every report. If someone is in danger, call 911 first.</Text>
      <ErrorText message={error} />
      <Button title={sending ? 'Sending…' : 'Send report'} onPress={send} disabled={!reason || sending} />
    </ListScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    noteCard: { padding: SPACE.lg },
    input: { ...inputStyle(c), minHeight: 96, textAlignVertical: 'top' },
    small: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
  });
