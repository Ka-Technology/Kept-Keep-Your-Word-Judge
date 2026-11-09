// Settings → Privacy & security (T48): the privacy policy (T50), who can see what, the check-in privacy note (T25),
// Face ID / Touch ID sign-in (T38), whether Kept's AI may check your days (T54), and Blocked
// accounts (T53, SPEC-friends.md), and Delete account (moved here from Settings in T121). As in the
// A3 mockup since T130 (full-set/ui-set-3-privacy.jpg): "Privacy and security" large, each item its own
// card with an outline icon, the switches in theirs, Delete account last in red.

import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { AccessibilityInfo, Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { ListRow, ListScreen, ListSection } from '@/components/list';
import { PageTitle } from '@/components/tab-title';
import { TimePickerSheet } from '@/components/profile-fields';
import { authErrorMessage } from '@/lib/auth-state';
import { useAuth } from '@/lib/auth';
import { deleteAccount as deleteEverything, DeletionBlockedError, deletionBlocker } from '@/lib/delete-account';
import { OPERATOR } from '@/lib/policies';
import { healthChoiceSummary } from '@/lib/health-consent';
import { aiChoiceSummary, CHECK_IN_PRIVACY_NOTE } from '@/lib/privacy-note';
import { canQuickSignIn, confirmWithBiometrics, deviceQuickSignIn, useQuickSignIn } from '@/lib/quick-sign-in';
import { supabase } from '@/lib/supabase';
import { SPACE, TEXT, TYPE, useStyles, type Colors } from '@/lib/theme';
import { useStepIn } from '@/lib/use-step-in';

import { EARLIEST_STEP_IN, quizOpensAt, retakeWindowText, stepInFromClock, stepInLabel, stepInPhrase } from '../../../supabase/functions/_shared/ai-limit';

/** Today at `minutes` after midnight, for the clock dial (midnight shows as 11:59 pm, the dial's last minute). */
const clockTime = (minutes: number) => {
  const date = new Date();
  date.setHours(0, Math.min(minutes, 24 * 60 - 1), 0, 0);
  return date;
};

// Not only the connection: a server-side refusal (T84's bug) showed up as "check your connection".
const DELETE_FAILED_MESSAGE = `Couldn't delete your account. Try again, or email ${OPERATOR.email}.`;

export default function PrivacySecurity() {
  const styles = useStyles(makeStyles);
  const { session, profile, updateProfile, signOut } = useAuth();
  const { stepIn, save } = useStepIn();
  // The dial's time until Done saves it.
  const [draft, setDraft] = useState(stepIn);
  const [picking, setPicking] = useState(false);
  const quick = useQuickSignIn();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Read synchronously, so a double tap on the dialog can't send two deletions.
  const inFlight = useRef(false);

  /** Deletes the account (its profile goes with it) and signs out, which returns to sign-in. */
  async function deleteAccount() {
    if (inFlight.current) return;
    inFlight.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (!session) throw new Error('signed out');
      await deleteEverything(session);
      await signOut();
    } catch (e) {
      const message = e instanceof DeletionBlockedError ? e.message : DELETE_FAILED_MESSAGE;
      setDeleteError(message);
      AccessibilityInfo.announceForAccessibility(message);
      inFlight.current = false;
      setDeleting(false);
    }
  }

  /** Saves a step-in time, saying so when it can't be. */
  function saveStepIn(minutes: number) {
    save(minutes).then((saved) => {
      if (!saved) Alert.alert('Couldn’t save that', 'Check your connection and try again.');
    });
  }

  /**
   * The time Kept's AI steps in (plan.md decision 180): a later time gives friends longer to approve a day, and leaves
   * less time to retake a photo. A clock dial like an alarm's, to the minute, from 9 pm; saved with Done. Midnight, the
   * end of the day with no retakes, has its own button, since the dial's last minute is 11:59 pm.
   */
  function chooseStepIn() {
    setDraft(stepIn);
    if (Platform.OS === 'android') {
      // ponytail: Android is after the demo (T13); this path is untested until then.
      DateTimePickerAndroid.open({
        value: clockTime(stepIn),
        mode: 'time',
        onValueChange: (_event, date) => saveStepIn(stepInFromClock(date.getHours() * 60 + date.getMinutes())),
      });
    } else {
      setPicking(true);
    }
  }

  function finishPicking(minutes: number) {
    setPicking(false);
    if (minutes !== stepIn) saveStepIn(minutes);
  }

  /** Not while money is still promised (decision 103). Deleting can't be undone, so ask first. */
  async function confirmDelete() {
    if (deleting || !session) return;
    const blocked = await deletionBlocker(session.user.id).catch(() => null);
    if (blocked) return Alert.alert('You can’t delete your account yet', blocked);
    Alert.alert('Delete your account?', "Your account and everything in it will be deleted. This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete account', style: 'destructive', onPress: deleteAccount },
    ]);
  }

  /** On saves at once; off first says what it costs (T54: a day no friend approves is missed). */
  function setAiAllowed(on: boolean) {
    const save = (value: boolean) =>
      updateProfile({ ai_allowed: value }).then((result) => {
        if (result !== 'saved') Alert.alert('Couldn’t save that', 'Check your connection and try again.');
      });
    if (on) return save(true);
    Alert.alert('Stop Kept’s AI checking your days?', aiChoiceSummary(false), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Don’t allow', style: 'destructive', onPress: () => save(false) },
    ]);
  }

  /**
   * Off deletes the saved sign-in. On takes one scan first, then asks for the password and checks it,
   * so a typo is never saved.
   */
  async function setQuickSignIn(on: boolean) {
    const email = session?.user.email;
    if (!on) {
      deviceQuickSignIn.turnOff().finally(quick.refresh);
      return;
    }
    if (!email || !quick.name || !(await confirmWithBiometrics(quick.name))) return;
    // ponytail: Alert.prompt is iOS-only; Android (T13) needs its own password box here.
    Alert.prompt(`Turn on ${quick.name}`, 'Enter your Kept password.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Turn on',
        onPress: async (password?: string) => {
          if (!password) return;
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) return Alert.alert(authErrorMessage(error));
          await deviceQuickSignIn.turnOn({ email, password }).catch(() => {});
          quick.refresh();
        },
      },
    ], 'secure-text');
  }

  return (
    <ListScreen>
      <PageTitle title="Privacy and security" />
      {quick.name && canQuickSignIn(session?.user.app_metadata.provider) && (
        <ListSection footer={`Kept keeps your password on this phone, locked behind ${quick.name}, and signs you in with one scan.`}>
          <ListRow
            label={quick.name}
            icon={quick.name === 'Face ID' ? { ios: 'faceid', android: 'face' } : { ios: 'touchid', android: 'fingerprint' }}
            toggle={{ value: quick.choice === 'on', onValueChange: setQuickSignIn }}
            first
          />
        </ListSection>
      )}
      <ListSection footer="An authenticator app’s code after your password, so your money stays yours even if someone learns it.">
        <ListRow label="Two-step verification" icon={{ ios: 'lock.shield', android: 'shield_lock' }} onPress={() => router.push('/settings/two-step')} first />
      </ListSection>
      <ListSection footer={healthChoiceSummary(profile?.health_allowed ?? null)}>
        <ListRow
          label="Let Kept keep health habits"
          icon={{ ios: 'heart.text.square', android: 'monitor_heart' }}
          toggle={{
            value: profile?.health_allowed === true,
            onValueChange: (value) =>
              updateProfile({ health_allowed: value }).then((result) => {
                if (result !== 'saved') Alert.alert('Couldn’t save that', 'Check your connection and try again.');
              }),
          }}
          first
        />
      </ListSection>
      <ListSection footer={aiChoiceSummary(profile?.ai_allowed ?? null, stepIn)}>
        <ListRow
          label="Let Kept’s AI check my days"
          icon={{ ios: 'sparkles', android: 'auto_awesome' }}
          toggle={{ value: profile?.ai_allowed === true, onValueChange: setAiAllowed }}
          first
        />
      </ListSection>
      {profile?.ai_allowed === true && (
        <ListSection footer={`${retakeWindowText(stepIn)}. Friends have until then to approve your day, and your quiz opens at ${stepInPhrase(quizOpensAt(stepIn))}.`}>
          <ListRow label="When Kept’s AI steps in" icon={{ ios: 'clock', android: 'schedule' }} value={stepInLabel(stepIn)} onPress={chooseStepIn} first />
        </ListSection>
      )}
      {profile?.ai_allowed === true && (
        <TimePickerSheet
          visible={picking}
          title="When Kept’s AI steps in"
          value={clockTime(draft)}
          from={clockTime(EARLIEST_STEP_IN)}
          to={clockTime(24 * 60 - 1)}
          onChange={(date) => setDraft(stepInFromClock(date.getHours() * 60 + date.getMinutes()))}
          onDone={() => finishPicking(draft)}
        >
          <Text style={styles.stepInNote}>{`${stepInLabel(draft)}. ${retakeWindowText(draft)}.`}</Text>
          <Button title="Midnight: no retakes" variant="link" onPress={() => finishPicking(24 * 60)} />
        </TimePickerSheet>
      )}
      <ListSection footer="Block or report someone from their profile, a check-in, a friend request or a public challenge.">
        <ListRow label="Blocked people" icon={{ ios: 'nosign', android: 'block' }} onPress={() => router.push('/settings/blocked')} first />
      </ListSection>
      {/* Facts, not settings, so plain text rather than rows that look like a menu (decision 170, T212). */}
      <View style={styles.whoSees}>
        <Text style={styles.whoTitle} accessibilityRole="header">
          Who sees what
        </Text>
        {WHO_SEES.map(([what, who]) => (
          <Text key={what} style={styles.whoLine}>
            <Text style={styles.what}>{what}: </Text>
            {who}
          </Text>
        ))}
        <Text style={styles.whoLine}>{CHECK_IN_PRIVACY_NOTE}</Text>
      </View>
      <ListSection>
        <ListRow
          label="Privacy Policy"
          icon={{ ios: 'doc.text', android: 'description' }}
          onPress={() => router.push({ pathname: '/policy/[doc]', params: { doc: 'privacy' } })}
          first
        />
      </ListSection>
      <ListSection footer="Deletes your account and everything in it. This can't be undone, and it waits until every challenge you're in or back has ended.">
        <ListRow label={deleting ? 'Deleting…' : 'Delete account'} icon={{ ios: 'trash', android: 'delete' }} onPress={confirmDelete} destructive first />
      </ListSection>
      <ErrorText message={deleteError} />
    </ListScreen>
  );
}

/** Who sees each part of you on Kept; none of it is a setting. */
const WHO_SEES: [what: string, who: string][] = [
  ['Your challenges', 'your friends. A public one also shows backers its progress (the habit, the day, your shields and the charity), never who you are.'],
  ['Your profile photo and username', 'anyone on Kept.'],
  ['Your completion rate', 'your friends.'],
  ['Your check-in photos', 'you and your friends.'],
  ['Your name, email, date of birth and state', 'no one else.'],
];

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    whoSees: { gap: SPACE.sm, marginHorizontal: SPACE.xs },
    whoTitle: { ...TYPE.section, color: c.text },
    whoLine: { ...TEXT.note, color: c.secondaryText },
    what: { color: c.text, fontWeight: '600' },
    stepInNote: { ...TEXT.note, color: c.secondaryText, textAlign: 'center', marginHorizontal: SPACE.lg },
  });
