// Review a friend's check-in (T26, SPEC-verification.md): the photo with Kept's stamp (or, for
// Read, the book and pages), next to what the habit's check asks for. Approve it, or tap
// "Doesn't look right" (with an optional note), which asks the challenger to redo it the habit's way
// (a new photo or screenshot, or checking in again); if they don't, the AI checks this one near the
// deadline. A friend can't reject: only the AI can, and the database enforces that. A Read or Learn a
// language quiz shows each question, the answer and the AI's grading (T42). Approving gives a
// success tap (owner, 2026-10-02). As in the A3 mockup since T135 (full-set/ui-flow-1-review.jpg):
// "Alex’s Day 9" beside their photo, the check-in photo in a card with its time chip, Approve in a
// card, and a red "This doesn’t look right" card whose note box opens under it.

import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { CheckInPhoto } from '@/components/check-in-photo';
import { ErrorText } from '@/components/error-text';
import { ReportBlock } from '@/components/report-block';
import { LoadingScreen } from '@/components/step-screen';
import { PageTitle } from '@/components/tab-title';
import { Tile } from '@/components/tile';
import { isObjectionable, OBJECTIONABLE_MESSAGE } from '@/lib/moderation';
import { supabase } from '@/lib/supabase';
import { inputStyle, PLACEHOLDER_COLOR, SCREEN, SPACE, TEXT, useStyles, type Colors } from '@/lib/theme';
import { useReviews } from '@/lib/use-reviews';

import type { Grade, Quiz } from '../../../supabase/functions/_shared/quiz';

const GRADE_WORDS: Record<Grade, string> = { right: 'right', wrong: 'wrong', unsure: 'the AI wasn’t sure' };

export default function ReviewCheckIn() {
  const styles = useStyles(makeStyles);
  const { checkInId } = useLocalSearchParams<{ checkInId: string }>();
  const { reviews, failed, reload } = useReviews();
  const review = reviews?.find((r) => r.check_in_id === checkInId);
  // The quiz, if any: friends may read the check-in, so it comes straight from the table.
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  useEffect(() => {
    supabase
      .from('check_ins')
      .select('quiz')
      .eq('id', checkInId)
      .maybeSingle()
      .then(({ data }) => setQuiz((data?.quiz as Quiz | null) ?? null));
  }, [checkInId]);
  const [note, setNote] = useState('');
  const [flagging, setFlagging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read synchronously, so a double tap can't send two reviews.
  const inFlight = useRef(false);

  /** Approves it, or asks for a new photo with the note; then goes back to the list. */
  async function submit(status: 'approved' | 'flagged') {
    if (inFlight.current) return;
    if (status === 'flagged' && isObjectionable(note)) {
      setError(OBJECTIONABLE_MESSAGE);
      return AccessibilityInfo.announceForAccessibility(OBJECTIONABLE_MESSAGE);
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from('check_ins')
      .update(status === 'flagged' ? { status, flag_note: note.trim() || null } : { status })
      .eq('id', checkInId);
    inFlight.current = false;
    setBusy(false);
    if (!error) {
      if (status === 'approved') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(status === 'approved' ? 'Approved.' : 'Asked them to redo it.');
      return router.back();
    }
    const message = error.code
      ? 'This check-in isn’t waiting for your review any more.'
      : 'Couldn’t reach Kept. Check your connection and try again.';
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
    reload();
  }

  if (!review) {
    if (reviews && !failed) {
      return (
        <View style={styles.center}>
          <Text style={styles.body}>This check-in doesn’t need your review any more.</Text>
          <Button title="Go back" onPress={() => router.back()} variant="secondary" />
        </View>
      );
    }
    return <LoadingScreen failed={failed} onRetry={reload} message="Couldn’t load this check-in. Check your connection and try again." />;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      <PageTitle
        title={`${review.username}’s Day ${review.day}`}
        subtitle={review.habit_name}
        icon={<Avatar path={review.avatar_path} username={review.username} size={60} />}
      />

      <Tile style={styles.photoCard}>
        {review.photo_path ? (
          <CheckInPhoto
            path={review.photo_path}
            day={review.day}
            takenAt={review.photo_taken_at}
            timeZone={review.time_zone}
            label={`${review.username}’s check-in photo`}
          />
        ) : (
          <Text style={styles.secondary}>No photo: Learn a language checks in without one until its quiz arrives.</Text>
        )}
        {review.book && (
          <Text style={styles.body}>
            {review.book}, pages {review.pages}
          </Text>
        )}
        <Text style={styles.secondary}>{review.photo_path ? 'Taken with Kept’s camera. ' : ''}The check asks for: {review.check_summary}</Text>
      </Tile>

      {quiz?.attempts
        .filter((a) => a.answers)
        .map((a, i) => (
          <Tile key={i}>
            <Text style={styles.label}>{quiz.attempts.length > 1 ? `Quiz, attempt ${i + 1}` : 'Quiz'}</Text>
            {a.questions.map((q, j) => (
              <Text key={j} style={styles.body}>
                {q.prompt}
                {q.speak ? ` (read aloud: “${q.speak}”)` : ''}
                {'\n'}“{a.answers![j]}”: {a.grades ? GRADE_WORDS[a.grades[j]] : 'not graded'}
              </Text>
            ))}
          </Tile>
        ))}

      <Tile>
        <Button title={busy ? 'Saving…' : 'Approve'} onPress={() => submit('approved')} disabled={busy} />
      </Tile>

      <Tile style={styles.flagCard}>
        <Pressable
          onPress={() => setFlagging((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: flagging }}
          style={({ pressed }) => [styles.flagHead, pressed && styles.pressed]}
        >
          <Text style={styles.flagTitle}>This doesn’t look right</Text>
        </Pressable>
        {flagging && (
          <View style={styles.flag}>
            <TextInput
              style={styles.input}
              placeholder="What doesn’t look right? They’ll see this (optional)"
              placeholderTextColor={PLACEHOLDER_COLOR}
              accessibilityLabel="Note for your friend, optional"
              value={note}
              onChangeText={setNote}
              maxLength={500}
              multiline
              autoFocus
            />
            <Button title={busy ? 'Saving…' : 'Ask them to redo it'} onPress={() => submit('flagged')} disabled={busy} variant="destructive" />
            <Text style={styles.secondary}>
              They’re asked to redo their check-in (a new photo or screenshot, or checking in again), and you’ll review it again. If they don’t, Kept’s
              AI checks this one near the deadline. Friends can’t fail a day; only the AI can, and it can be appealed.
            </Text>
          </View>
        )}
      </Tile>
      <ErrorText message={error} />
      <ReportBlock report={{ checkInId }} block={{ user: review.challenger_id }} name={`@${review.username}`} onBlocked={() => router.back()} />
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: SCREEN,
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.lg, padding: SPACE.xxl, backgroundColor: c.groupedBackground },
    photoCard: { gap: SPACE.md },
    label: { ...TEXT.caption, color: c.secondaryText, fontWeight: '600' },
    body: { ...TEXT.body, color: c.text },
    secondary: { ...TEXT.note, color: c.secondaryText },
    flagCard: { gap: SPACE.md },
    flagHead: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    pressed: { opacity: 0.6 },
    flagTitle: { ...TEXT.row, color: c.error, fontWeight: '600' },
    flag: { gap: SPACE.sm },
    input: { ...inputStyle(c), minHeight: 60 },
  });
