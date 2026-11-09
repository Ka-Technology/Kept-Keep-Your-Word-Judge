// Check in for today (T25, SPEC-verification.md): the habit's check and Kept's stamp, then a photo
// from Kept's camera (or a screenshot, for screen-based habits; only a screenshot for Meditate),
// shrunk to 1000 px and uploaded to the private bucket. The check-in waits for a friend. Until
// someone reviews it, after a friend's "doesn't look right", or when the AI asks for one, the
// challenger can send a new one, which replaces the old. Read also asks for the book and pages;
// Learn a language checks in without a photo, and after a friend's "doesn't look right" it checks in
// again. Friends get the first chance: if none has approved by the user's step-in time (10 pm unless they chose
// later; plan.md decision 180) in the challenge's zone, a Read or Learn a language challenger can take the AI
// quiz instead (T42; the quiz function writes and grades, and says when the user's AI limit is reached). With `day`, it shows a past day from the Days list, where a rejected day can be appealed (T29).
// An account from before decision 96, which never answered, is asked before its first check-in
// whether Kept's AI may check its days (T54); without that, there's no quiz and only friends who
// back them check the days. Sending a check-in sets down the K stamp with a success tap (owner,
// 2026-10-02); an approved day keeps it. One that didn't pass (a friend or Kept's AI asked for it
// again, or it wasn't approved) leads with a red tile: what went wrong, and the controls to do it
// again or appeal it. Each state is its own component (components/check-in-states.tsx, T97); this
// screen loads the day and does the sending.

import * as Haptics from 'expo-haptics';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { DidntPass, NewCheckIn, SentCheckIn, type DayCheckIn } from '@/components/check-in-states';
import { ErrorText } from '@/components/error-text';
import { ChallengeHeader } from '@/components/habit-icon';
import { LoadingScreen } from '@/components/step-screen';
import { useAuth } from '@/lib/auth';
import { checkInErrorMessage } from '@/lib/challenges';
import { checkInPhotoPath, evidenceFor, QUIZ_LIMITED_NOTE, quizProblem, stampText } from '@/lib/check-in';
import { removeCheckInPhoto, takeCheckInPhoto, uploadCheckInPhoto } from '@/lib/check-in-photos';
import type { FriendRow } from '@/lib/friends';
import { AI_CHOICE_MESSAGE, AI_CHOICE_TITLE } from '@/lib/privacy-note';
import { rescheduleShieldWarnings } from '@/lib/notifications';
import { isObjectionable, OBJECTIONABLE_MESSAGE } from '@/lib/moderation';
import { supabase } from '@/lib/supabase';
import { SCREEN, SPACE, TEXT, useStyles, type Colors } from '@/lib/theme';
import { autoStart } from '@/lib/today';
import { must, useFocusLoad } from '@/lib/use-focus-load';
import { useStepIn } from '@/lib/use-step-in';
import { useMyChallenges } from '@/lib/use-my-challenges';

import { quizOpensAt, stepInPhrase } from '../../../supabase/functions/_shared/ai-limit';
import { nextStep, QUESTIONS, quizOpen } from '../../../supabase/functions/_shared/quiz';

type Details = {
  habitId: string;
  /** Learn a language's language code, for the listening question's voice. */
  language: string | null;
  timeZone: string;
  check: string;
  checkIn: DayCheckIn | null;
  /** The username of the friend who reviewed today's check-in, if any. */
  reviewer: string | null;
};

/** Asks an account still at null whether Kept's AI may check its days (T54): two plain answers, neither preselected. */
function askAiChoice(): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      AI_CHOICE_TITLE,
      AI_CHOICE_MESSAGE,
      [
        { text: 'Don’t allow', onPress: () => resolve(false) },
        { text: 'Allow', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    ),
  );
}

export default function CheckInScreen() {
  const styles = useStyles(makeStyles);
  const { session, profile, updateProfile } = useAuth();
  // Whether Kept's AI may check this user's days (T54): no quiz, and friends-only wording, otherwise.
  const aiAllowed = profile?.ai_allowed === true;
  // When the AI steps in for this user (10 pm unless they chose later), which is when the quiz opens (never after 11 pm).
  const { stepIn } = useStepIn();
  const quizAt = stepInPhrase(quizOpensAt(stepIn));
  // `start` comes from a due card on the Check in tab: open the habit's check straight away.
  const { challengeId, day: dayParam, start } = useLocalSearchParams<{ challengeId: string; day?: string; start?: string }>();
  const { challenges, failed, reload } = useMyChallenges(challengeId);
  const challenge = challenges?.[0];
  // Today's check-in, or a past day's from the challenge's Days list (to see it, or appeal it; T29).
  const day = dayParam ? Number(dayParam) : challenge?.today;
  const pastDay = day !== challenge?.today;
  const [book, setBook] = useState('');
  const [pages, setPages] = useState('');
  const [appealNote, setAppealNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once a check-in is sent from this screen, so its stamp drops in with a success tap.
  const [justSent, setJustSent] = useState(false);
  // Read synchronously, so a double tap can't send two check-ins.
  const inFlight = useRef(false);

  // The habit's check, the day's check-in (if there is one) and who reviewed it; reloaded on focus,
  // with a retry if it can't load.
  const {
    data: details,
    failed: detailsFailed,
    reload: loadDetails,
  } = useFocusLoad(async (): Promise<Details> => {
    const [found, friends] = await Promise.all([
      supabase
        .from('challenges')
        .select('habit_id, language, time_zone, habits(check_summary), check_ins(id, status, photo_path, photo_taken_at, book, pages, reviewer_id, reviewed_at, flag_note, ai_checked_at, ai_verdict, ai_reason, appeal_note, appealed_at, owner_note, quiz)')
        .eq('id', challengeId)
        .eq('check_ins.day', day!)
        .single(),
      supabase.rpc('my_friends'),
    ]);
    const row = must(found) as unknown as {
      habit_id: string;
      language: string | null;
      time_zone: string;
      habits: { check_summary: string } | null;
      check_ins: DayCheckIn[];
    };
    const checkIn = row.check_ins[0] ?? null;
    const reviewer = ((friends.data ?? []) as FriendRow[]).find((f) => f.user_id === checkIn?.reviewer_id)?.username ?? null;
    return { habitId: row.habit_id, language: row.language, timeZone: row.time_zone, check: row.habits?.check_summary ?? '', checkIn, reviewer };
  }, day ? `${challengeId}:${day}` : null);

  function showError(message: string) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
  }

  /**
   * The quiz (T42): asks the quiz function for the next questions, or with `answers` to grade them
   * (a pass approves the check-in), then reloads.
   */
  async function quizCall(checkInId: string, answers?: string[], note?: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke('quiz', { body: { checkInId, answers, note } });
    inFlight.current = false;
    setBusy(false);
    if (error) {
      // The function says why in its answer: the limit, the quiz not open yet, or another request already making it.
      const answer = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
      showError(quizProblem(answer?.error, { answering: !!answers, opensAt: quizAt }));
    } else if (data?.limited) {
      // The first day over the limit in a challenge: no quiz, and the day counts without one.
      Alert.alert('Kept’s AI', QUIZ_LIMITED_NOTE);
    }
    reload();
    loadDetails();
  }

  /** Appeals a rejected day to Kept's owner (T29): once, within 7 days, with a short note. */
  async function appeal() {
    const checkIn = details?.checkIn;
    if (!checkIn || inFlight.current) return;
    const note = appealNote.trim();
    if (!note) return showError('Say briefly why this day should count.');
    if (isObjectionable(note)) return showError(OBJECTIONABLE_MESSAGE);
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('check_ins').update({ status: 'appealed', appeal_note: note }).eq('id', checkIn.id);
    inFlight.current = false;
    setBusy(false);
    if (error) {
      showError(error.code ? 'This day can’t be appealed any more.' : 'Couldn’t reach Kept. Check your connection and try again.');
    } else {
      AccessibilityInfo.announceForAccessibility('Appeal sent.');
    }
    reload();
    loadDetails();
  }

  /**
   * Checks in (or sends a new photo): takes the photo, uploads it, then saves the check-in. The
   * database stamps the time and keeps it pending. `source` null checks in without a photo.
   */
  async function checkIn(source: 'camera' | 'screenshot' | null) {
    if (!challenge || !details || !session || inFlight.current) return;
    const existing = details.checkIn;
    const read = details.habitId === 'read' && !existing ? { book: book.trim(), pages: pages.trim() } : null;
    if (read && (!read.book || !read.pages)) return showError('Enter the book and the pages you read.');
    inFlight.current = true;
    setBusy(true);
    setError(null);
    // An uploaded photo whose check-in didn't save is deleted again in `finally`.
    let orphan: string | null = null;
    try {
      // An account still at null answers first (T54), saved on the profile for the AI job to honor.
      if (profile?.ai_allowed === null && (await updateProfile({ ai_allowed: await askAiChoice() })) !== 'saved') {
        return showError('Your choice couldn’t be saved. Check your connection and try again.');
      }
      let path: string | null = null;
      if (source) {
        const taken = await takeCheckInPhoto(source);
        if (taken === 'no-permission') {
          return Alert.alert('Camera access is off', 'To check in, allow Kept to use the camera in your phone’s Settings.', [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]);
        }
        if (!taken) return;
        path = checkInPhotoPath(session.user.id, challenge.id, challenge.today, Date.now());
        await uploadCheckInPhoto(path, taken);
        orphan = path;
      }
      const { error } = existing
        ? await supabase.from('check_ins').update({ photo_path: path, status: 'pending' }).eq('id', existing.id)
        : await supabase.from('check_ins').insert({ challenge_id: challenge.id, day: challenge.today, photo_path: path, ...read });
      if (error) throw error;
      orphan = null;
      if (existing) await removeCheckInPhoto(existing.photo_path);
      // A new photo after the AI's retake is checked again at once (T28); if this call fails, Cron's next run does it.
      if (existing?.status === 'retake') await supabase.functions.invoke('ai-check', { body: { challengeId: challenge.id } });
      setJustSent(true);
      AccessibilityInfo.announceForAccessibility(existing?.status === 'retake' ? 'Sent. Kept’s AI is checking it.' : 'Checked in. Waiting for a friend.');
    } catch (e) {
      showError(checkInErrorMessage(e as { code?: string; message?: string }));
    } finally {
      await removeCheckInPhoto(orphan);
      inFlight.current = false;
      setBusy(false);
      reload();
      // A check-in cancels today's shield warning (T35).
      rescheduleShieldWarnings();
      loadDetails();
    }
  }

  // One tap from a due card (owner interview, 2026-09-27): once today's details load with no
  // check-in yet, open the camera or the screenshot picker when that's the habit's only way in.
  const started = useRef(false);
  const startCheckIn = useEffectEvent((how: 'camera' | 'screenshot') => void checkIn(how));
  useEffect(() => {
    if (start !== '1' || started.current || !details || details.checkIn || pastDay) return;
    started.current = true;
    const how = autoStart(details.habitId);
    // Right after the screen shows, rather than while it renders.
    if (how) setTimeout(() => startCheckIn(how), 0);
  }, [start, details, pastDay]);

  if (!challenge || !details) {
    return (
      <LoadingScreen
        failed={failed || detailsFailed || (challenges !== null && !challenge)}
        onRetry={() => (reload(), loadDetails())}
        message="Couldn’t load this check-in. Check your connection and try again."
      />
    );
  }
  if (!pastDay && challenge.state !== 'active') {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>
          {challenge.state === 'upcoming' ? 'Day 1 is tomorrow. Check in once it starts.' : 'This challenge has ended.'}
        </Text>
        <Button title="Go back" onPress={() => router.back()} variant="secondary" />
      </View>
    );
  }

  const { checkIn: existing, habitId, language, timeZone, check, reviewer } = details;
  const shownDay = day ?? challenge.today;
  // What this habit checks in with, and so how it's redone: Meditate only by screenshot (its proof is
  // a screen on this phone), Learn a language by checking in again (no photo; its check is the quiz).
  const evidence = evidenceFor(habitId);
  // The quiz (T42), on today's waiting Read or Learn a language check-in: it opens at the user's step-in time
  // (10 pm unless they chose later) if no friend has approved by then. The photo stays hidden while it's answered.
  const step = aiAllowed && existing && !pastDay && existing.status === 'pending' && QUESTIONS[habitId] ? nextStep(existing.quiz) : null;
  const canRetake = !pastDay && step !== 'answer' && !!existing?.photo_path && ['pending', 'flagged', 'retake'].includes(existing.status);
  const canCheckInAgain = !pastDay && evidence === 'none' && existing?.status === 'flagged';
  // Didn't pass: asked for again (flagged, retake) or not approved (rejected).
  const didntPass = existing?.status === 'flagged' || existing?.status === 'retake' || existing?.status === 'rejected';
  const sent = existing && { checkIn: existing, reviewer, evidence, day: shownDay, timeZone };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      {/* A sent check-in leads with its photo and its own big title (A3, T102); the rest with the habit's header. */}
      {(!sent || didntPass) && (
        <ChallengeHeader habitId={habitId} title={challenge.title} status={pastDay ? `Day ${day}` : stampText(challenge.today, new Date(), timeZone, false)} />
      )}

      {sent ? (
        didntPass ? (
          <DidntPass
            {...sent}
            canRetake={canRetake}
            canCheckInAgain={canCheckInAgain}
            appealNote={appealNote}
            onAppealNote={setAppealNote}
            busy={busy}
            onSend={checkIn}
            onAppeal={appeal}
          />
        ) : (
          <SentCheckIn
            {...sent}
            challenge={challenge}
            language={language}
            step={step}
            quizOpenNow={quizOpen(new Date(), timeZone, stepIn)}
            quizAt={quizAt}
            canRetake={canRetake}
            justSent={justSent}
            busy={busy}
            onSend={checkIn}
            onQuiz={(answers, note) => quizCall(sent.checkIn.id, answers, note)}
            onDone={() => router.back()}
          />
        )
      ) : pastDay ? (
        <Text style={styles.body}>No check-in on Day {day}.</Text>
      ) : (
        <NewCheckIn
          check={check}
          habitId={habitId}
          evidence={evidence}
          aiAllowed={aiAllowed}
          quizAt={quizAt}
          book={book}
          pages={pages}
          onBook={setBook}
          onPages={setPages}
          busy={busy}
          onSend={checkIn}
        />
      )}
      <ErrorText message={error} />
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: SCREEN,
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.lg, padding: SPACE.xxl, backgroundColor: c.groupedBackground },
    body: { ...TEXT.body, color: c.text },
  });
