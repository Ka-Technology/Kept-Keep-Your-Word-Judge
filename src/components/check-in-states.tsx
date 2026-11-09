// The check-in screen's states, one component each (T97; app/check-in/[challengeId].tsx picks one):
// a new check-in, a sent one (the stamp landing right after sending, waiting for a friend, the AI
// quiz, or kept; A3, T102), and one that didn't pass (to do again or appeal). What a friend, Kept's AI
// and Kept's owner said about a check-in is one shared block (CheckInNotes), and so is its evidence
// (the photo, and Read's book and pages).

import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { BigStamp } from '@/components/big-stamp';
import { Button } from '@/components/button';
import { CheckInPhoto } from '@/components/check-in-photo';
import { HabitIcon } from '@/components/habit-icon';
import { ProgressRing } from '@/components/progress-ring';
import { QuizForm } from '@/components/quiz-form';
import { Tile } from '@/components/tile';
import type { CheckInStatus } from '@/lib/challenge-rules';
import { speechLanguage, type ChallengeSummary } from '@/lib/challenges';
import { aiApprovedOnDoubt, canAppeal, decidedByAI, pagesRead, QUIZ_LIMITED_NOTE, reviewedStatusText, type Evidence } from '@/lib/check-in';
import { FONTS, HERO_MAX_SCALE, ICON, inputStyle, PLACEHOLDER_COLOR, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';

import type { nextStep, Quiz } from '../../supabase/functions/_shared/quiz';

/** A day's check-in, as the check-in screen loads it. */
export type DayCheckIn = {
  id: string;
  status: CheckInStatus;
  photo_path: string | null;
  photo_taken_at: string | null;
  book: string | null;
  pages: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  flag_note: string | null;
  ai_checked_at: string | null;
  /** What the AI answered: approve, retake, not_approved or unsure. */
  ai_verdict: string | null;
  /** The AI's one-sentence reason, shown with a retake, a "not approved" or an appeal. */
  ai_reason: string | null;
  appeal_note: string | null;
  appealed_at: string | null;
  /** Kept's owner's note on an appeal's decision. */
  owner_note: string | null;
  quiz: Quiz | null;
};

/** Sends a check-in: with a photo, a screenshot, or (null) nothing. */
type Send = (source: 'camera' | 'screenshot' | null) => void;

/** What every sent check-in shows: the check-in, who reviewed it, and where it's from. */
type Sent = { checkIn: DayCheckIn; reviewer: string | null; evidence: Evidence; day: number; timeZone: string };

/** The habit's ways in: Take photo, Use a screenshot, or both; `again` words them for a new one. */
function PhotoButtons({ evidence, again, busy, onSend }: { evidence: Evidence; again: boolean; busy: boolean; onSend: Send }) {
  const styles = useStyles(makeStyles);
  const camera = evidence === 'camera' || evidence === 'either';
  const screenshot = evidence === 'screenshot' || evidence === 'either';
  return (
    <View style={styles.buttons}>
      {camera && <Button title={busy ? 'Uploading…' : again ? 'Take a new photo' : 'Take photo'} onPress={() => onSend('camera')} disabled={busy} />}
      {screenshot && (
        <Button
          title={busy && !camera ? 'Uploading…' : again ? 'Use a new screenshot' : 'Use a screenshot'}
          onPress={() => onSend('screenshot')}
          disabled={busy}
          variant={camera ? 'secondary' : 'primary'}
        />
      )}
    </View>
  );
}

/** What a friend, Kept's AI and Kept's owner said about the check-in, and the user's own appeal. */
function CheckInNotes({ checkIn }: { checkIn: DayCheckIn }) {
  const styles = useStyles(makeStyles);
  return (
    <>
      {checkIn.flag_note && <Text style={styles.note}>“{checkIn.flag_note}”</Text>}
      {['retake', 'rejected', 'appealed'].includes(checkIn.status) && checkIn.ai_reason && <Text style={styles.note}>{checkIn.ai_reason}</Text>}
      {checkIn.appeal_note && <Text style={styles.note}>Your appeal: “{checkIn.appeal_note}”</Text>}
      {checkIn.owner_note && <Text style={styles.note}>Kept: “{checkIn.owner_note}”</Text>}
    </>
  );
}

/** The check-in's photo (hidden while the quiz is answered) and, for Read, the book and pages. */
function CheckInEvidence({ checkIn, day, timeZone, label, hidePhoto = false }: { checkIn: DayCheckIn; day: number; timeZone: string; label: string; hidePhoto?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <>
      {checkIn.photo_path && !hidePhoto && <CheckInPhoto path={checkIn.photo_path} day={day} takenAt={checkIn.photo_taken_at} timeZone={timeZone} label={label} />}
      {checkIn.book && (
        <Text style={styles.body}>
          {checkIn.book}, pages {checkIn.pages}
        </Text>
      )}
    </>
  );
}

/** Today, not checked in yet: what to show, then the habit's way in. Read also asks for the book and pages. */
export function NewCheckIn({
  check,
  habitId,
  evidence,
  aiAllowed,
  quizAt,
  book,
  pages,
  onBook,
  onPages,
  busy,
  onSend,
}: {
  check: string;
  habitId: string;
  evidence: Evidence;
  aiAllowed: boolean;
  /** When the AI quiz opens for this user, in words ("10 pm"): their own step-in time, never later than 11 pm. */
  quizAt: string;
  book: string;
  pages: string;
  onBook: (book: string) => void;
  onPages: (pages: string) => void;
  busy: boolean;
  onSend: Send;
}) {
  const styles = useStyles(makeStyles);
  return (
    <>
      <Tile>
        <Text style={styles.caption}>What to show</Text>
        <Text style={styles.body}>{check}</Text>
      </Tile>
      {evidence === 'none' ? (
        <>
          <Text style={styles.note}>
            {aiAllowed
              ? `Check in, and a friend who backs you confirms. If none has by ${quizAt}, you can take a quick AI quiz instead: 4 questions, and one is read aloud.`
              : 'Check in, and a friend who backs you confirms it by midnight.'}
          </Text>
          <Button title={busy ? 'Checking in…' : 'Check in'} onPress={() => onSend(null)} disabled={busy} />
        </>
      ) : (
        <>
          {habitId === 'read' && (
            <View style={styles.buttons}>
              <TextInput
                style={styles.input}
                placeholder="Book"
                placeholderTextColor={PLACEHOLDER_COLOR}
                accessibilityLabel="The book you read"
                value={book}
                onChangeText={onBook}
                maxLength={200}
              />
              <TextInput
                style={styles.input}
                placeholder="Pages, e.g. 40–62"
                placeholderTextColor={PLACEHOLDER_COLOR}
                accessibilityLabel="The pages you read"
                value={pages}
                onChangeText={onPages}
                maxLength={50}
              />
              <Text style={styles.note}>
                {aiAllowed
                  ? `Then take a photo of the last page you read. If no friend approves it by ${quizAt}, you can take a quick AI quiz on it instead.`
                  : 'Then take a photo of the last page you read, for a friend who backs you to confirm.'}
              </Text>
            </View>
          )}
          <PhotoButtons evidence={evidence} again={false} busy={busy} onSend={onSend} />
        </>
      )}
    </>
  );
}

/**
 * Sent and not turned down (A3 mockup, T102: docs/design/mockups/checkin-A3v2.jpg): the photo with
 * its time and, once sent or kept, the green K box on it (it lands, with a success tap, right after
 * sending); "Day 12 is in" (or kept); the book and pages; a status card; a ring of the days kept
 * beside the book (pages read today) or the habit; then Done and "Retake photo". While waiting, a
 * Read or Learn a language check-in can take the AI quiz (T42), which opens at the user's step-in time if no friend has
 * approved by then.
 */
export function SentCheckIn({
  checkIn,
  reviewer,
  evidence,
  day,
  timeZone,
  challenge,
  language,
  step,
  quizOpenNow,
  quizAt,
  canRetake,
  justSent,
  busy,
  onSend,
  onQuiz,
  onDone,
}: Sent & {
  challenge: ChallengeSummary;
  language: string | null;
  /** Where the quiz stands (null when there's none to take). */
  step: ReturnType<typeof nextStep> | null;
  quizOpenNow: boolean;
  /** When the AI quiz opens for this user, in words ("10 pm"). */
  quizAt: string;
  canRetake: boolean;
  /** Sent from this screen just now: the stamp lands. */
  justSent: boolean;
  busy: boolean;
  onSend: Send;
  /** Asks for questions (with the language quiz's optional note), or grades `answers`. */
  onQuiz: (answers?: string[], note?: string) => void;
  onDone: () => void;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const quiz = checkIn.quiz;
  // Learn a language: an optional line about what was practiced. It helps choose the day's questions, and when Kept's AI writes
  // a new batch it gets the line too (owner, 2026-11-03); it is never saved.
  const [note, setNote] = useState('');
  const noteBox = challenge.habitId === 'language' && (
    <>
      <TextInput
        style={styles.input}
        placeholder="What did you practice today? (optional)"
        placeholderTextColor={PLACEHOLDER_COLOR}
        accessibilityLabel="What you practiced today, optional"
        value={note}
        onChangeText={setNote}
        maxLength={100}
        returnKeyType="done"
      />
      <Text style={styles.note}>If Kept’s AI writes new questions, it sees this line. It isn’t saved.</Text>
    </>
  );
  const noteToSend = challenge.habitId === 'language' ? note.trim() || undefined : undefined;
  const openAttempt = step === 'answer' ? quiz!.attempts.at(-1)! : null;
  const lastGrades = quiz?.attempts.at(-1)?.grades ?? [];
  const kept = checkIn.status === 'approved' || checkIn.status === 'excused';
  const pages = pagesRead(checkIn.pages);
  const camera = evidence === 'camera' || evidence === 'either';
  const screenshot = evidence === 'screenshot' || evidence === 'either';

  // The stamp lands on the photo with a success tap (without a photo, BigStamp taps for itself).
  useEffect(() => {
    if (justSent && checkIn.photo_path) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [justSent, checkIn.photo_path]);

  return (
    <>
      {checkIn.photo_path && !openAttempt ? (
        <CheckInPhoto
          path={checkIn.photo_path}
          day={day}
          takenAt={checkIn.photo_taken_at}
          timeZone={timeZone}
          label="Your check-in photo"
          chipAt="top"
          stamp={justSent ? 'land' : kept ? 'still' : undefined}
        />
      ) : (
        (kept || justSent) && <BigStamp color={colors.stamp} animate={justSent} />
      )}
      <View style={styles.heading}>
        <Text style={styles.bigTitle} accessibilityRole="header">
          {kept ? `Day ${day} is kept` : `Day ${day} is in`}
        </Text>
        {checkIn.book && (
          <Text style={styles.subtitle}>
            {checkIn.book}, pages {checkIn.pages}
          </Text>
        )}
      </View>
      <Tile style={styles.statusCard}>
        <SymbolView
          name={
            kept
              ? { ios: 'checkmark.seal', android: 'verified' }
              : checkIn.status === 'ai_checking'
                ? { ios: 'sparkles', android: 'auto_awesome' }
                : { ios: 'hourglass', android: 'hourglass_empty' }
          }
          size={ICON.hero}
          tintColor={colors.stamp}
        />
        <Text style={styles.statusText} accessibilityRole="alert">
          {reviewedStatusText(checkIn.status, reviewer, decidedByAI(checkIn), evidence, aiApprovedOnDoubt(checkIn))}
        </Text>
      </Tile>
      <View style={styles.tiles}>
        <Tile style={styles.ringTile}>
          <ProgressRing
            value={challenge.daysCompleted / challenge.daysRequired}
            size={76}
            stroke={8}
            color={colors.stamp}
            trackColor={colors.selected}
            accessibilityLabel={`${challenge.daysCompleted} of ${challenge.daysRequired} days kept`}
          >
            <Text style={styles.ringNumber} adjustsFontSizeToFit numberOfLines={1} maxFontSizeMultiplier={HERO_MAX_SCALE}>
              {challenge.daysCompleted}
            </Text>
            <Text style={styles.ringOf} allowFontScaling={false}>
              of {challenge.daysRequired}
            </Text>
          </ProgressRing>
          <Text style={styles.tileNote}>days kept</Text>
        </Tile>
        <Tile style={styles.habitTile}>
          <HabitIcon habitId={challenge.habitId} look="bare" />
          <View style={styles.habitText}>
            <Text style={styles.tileTitle} numberOfLines={2}>
              {checkIn.book ?? challenge.title}
            </Text>
            <Text style={styles.tileNote}>{pages ? `${pages} pages today` : `Day ${day} of ${challenge.daysRequired}`}</Text>
          </View>
        </Tile>
      </View>
      <CheckInNotes checkIn={checkIn} />
      {step === 'start' &&
        (quizOpenNow ? (
          <>
            <Text style={styles.note}>No friend has approved this yet, so you can take a quick AI quiz instead.</Text>
            {noteBox}
            <Button title={busy ? 'Making your quiz…' : 'Take the quiz'} onPress={() => onQuiz(undefined, noteToSend)} disabled={busy} />
          </>
        ) : (
          <Text style={styles.note}>If no friend approves this by {quizAt}, you can take a quick AI quiz instead.</Text>
        ))}
      {openAttempt && (
        <QuizForm key={quiz!.attempts.length} questions={openAttempt.questions} speechLanguage={speechLanguage(language)} busy={busy} onSubmit={onQuiz} />
      )}
      {step === 'retry' && quizOpenNow && (
        <>
          <Text style={styles.body}>
            Not quite: {lastGrades.filter((g) => g === 'right').length} of {lastGrades.length} right. You can try once more, with new questions.
          </Text>
          {noteBox}
          <Button title={busy ? 'Making your quiz…' : 'Try new questions'} onPress={() => onQuiz(undefined, noteToSend)} disabled={busy} />
        </>
      )}
      {step === 'done' && (
        <Text style={styles.note}>
          {quiz?.limited
            ? QUIZ_LIMITED_NOTE
            : quiz?.skipped
            ? challenge.habitId === 'read'
              ? 'Kept’s AI didn’t know this book well enough for a fair quiz, so it checks your photo when the day ends.'
              : 'Kept’s AI couldn’t make a fair quiz this time, so this day counts without one.'
            : 'Your answers go to your friends. If none approves by midnight, Kept’s AI decides from them.'}
        </Text>
      )}
      <Button title="Done" onPress={onDone} />
      {canRetake && camera && <Button title={busy ? 'Uploading…' : 'Retake photo'} onPress={() => onSend('camera')} disabled={busy} variant="link" />}
      {canRetake && screenshot && (
        <Button title={busy && !camera ? 'Uploading…' : 'Use a new screenshot'} onPress={() => onSend('screenshot')} disabled={busy} variant="link" />
      )}
    </>
  );
}

/**
 * Didn't pass (a friend or Kept's AI asked for it again, or it wasn't approved): a red tile with what
 * went wrong and the controls to do it again or, once and within 7 days, appeal it (T29).
 */
export function DidntPass({
  checkIn,
  reviewer,
  evidence,
  day,
  timeZone,
  canRetake,
  canCheckInAgain,
  appealNote,
  onAppealNote,
  busy,
  onSend,
  onAppeal,
}: Sent & {
  canRetake: boolean;
  canCheckInAgain: boolean;
  appealNote: string;
  onAppealNote: (note: string) => void;
  busy: boolean;
  onSend: Send;
  onAppeal: () => void;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const rejected = checkIn.status === 'rejected';
  return (
    <>
      <Tile tone="alert">
        <View style={styles.alertHead}>
          <SymbolView
            name={rejected ? { ios: 'xmark.octagon.fill', android: 'cancel' } : { ios: 'arrow.counterclockwise.circle.fill', android: 'replay' }}
            size={ICON.hero}
            tintColor={colors.error}
          />
          <Text style={styles.alertTitle}>{rejected ? 'Not approved' : 'Do it again'}</Text>
        </View>
        <Text style={styles.status} accessibilityRole="alert">
          {reviewedStatusText(checkIn.status, reviewer, decidedByAI(checkIn), evidence, aiApprovedOnDoubt(checkIn))}
        </Text>
        <CheckInNotes checkIn={checkIn} />
        {canRetake && <PhotoButtons evidence={evidence} again busy={busy} onSend={onSend} />}
        {canCheckInAgain && <Button title={busy ? 'Checking in…' : 'Check in again'} onPress={() => onSend(null)} disabled={busy} />}
        {canAppeal(checkIn, new Date()) && (
          <View style={styles.buttons}>
            <TextInput
              style={[styles.input, styles.appealInput]}
              placeholder="Why should this day count? Kept reads this."
              placeholderTextColor={PLACEHOLDER_COLOR}
              accessibilityLabel="Your appeal note"
              value={appealNote}
              onChangeText={onAppealNote}
              maxLength={500}
              multiline
            />
            <Button title={busy ? 'Sending…' : 'Appeal'} onPress={onAppeal} disabled={busy} />
            <Text style={styles.note}>
              You can appeal once, within 7 days. A person at Kept looks at your check-in and the reason, then restores the day or keeps the
              decision.
            </Text>
          </View>
        )}
      </Tile>
      <CheckInEvidence checkIn={checkIn} day={day} timeZone={timeZone} label="The check-in photo that didn’t pass" />
    </>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    title: { ...TYPE.title, color: c.text },
    caption: { ...TEXT.caption, color: c.secondaryText, fontWeight: '600' },
    body: { ...TEXT.body, color: c.text },
    note: { ...TEXT.note, color: c.secondaryText },
    status: { ...TYPE.heading, color: c.text },
    alertHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
    alertTitle: { ...TYPE.title, color: c.error },
    buttons: { gap: SPACE.md },
    input: inputStyle(c),
    appealInput: { minHeight: 80, textAlignVertical: 'top' },
    // The sent state (T102).
    heading: { gap: SPACE.xs, marginHorizontal: SPACE.xs },
    bigTitle: { ...TYPE.display, color: c.text },
    subtitle: { ...TEXT.row, color: c.secondaryText },
    statusCard: { flexDirection: 'row', alignItems: 'center', gap: SPACE.lg, padding: SPACE.xl },
    statusText: { ...TEXT.row, color: c.text, flex: 1 },
    tiles: { flexDirection: 'row', gap: SPACE.md },
    // Both tiles centered, the ring or icon over its words (owner, 2026-10-18, T148).
    ringTile: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.sm },
    ringNumber: { ...TYPE.section, fontFamily: FONTS.heavy, color: c.text, paddingHorizontal: SPACE.sm },
    ringOf: { ...TEXT.caption, color: c.secondaryText },
    habitTile: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.sm },
    habitText: { alignItems: 'center', gap: SPACE.xxs },
    tileTitle: { ...TYPE.section, color: c.text, textAlign: 'center' },
    tileNote: { ...TEXT.caption, color: c.secondaryText, textAlign: 'center' },
  });
