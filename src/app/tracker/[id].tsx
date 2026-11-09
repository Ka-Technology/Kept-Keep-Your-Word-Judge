// A free tracker (owner, 2026-10-01; docs/specs/SPEC-trackers.md; bento, 2026-10-02; A3): a tile
// with the streak (or a goal's green ring), Done for today or yesterday (and Undo, for a mis-tap),
// which sets down the K stamp, tiles for shields and days done, the last 14 days as stamps, and
// Archive. Private: only the user sees it, and nothing here checks anything. The database allows
// only today and yesterday (migration 0040). As in the A3 mockup since T139 (full-set/ui-flow-6-tracker.jpg):
// the name and "Free tracker", a ring of days tracked beside "in a row", this month as a calendar card
// (each done day a green K box), and Mark today done.

import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BigStamp } from '@/components/big-stamp';
import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { ChallengeHeader } from '@/components/habit-icon';
import { ProgressRing } from '@/components/progress-ring';
import { MonthCard } from '@/components/stamp-card';
import { LoadingScreen } from '@/components/step-screen';
import { Tile } from '@/components/tile';
import { rescheduleShieldWarnings } from '@/lib/notifications';
import { fromDateString } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { HERO_MAX_SCALE, SCREEN, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { summarizeTracker, TRACKER_COLUMNS, trackerErrorMessage, trackerLine, type TrackerRow } from '@/lib/trackers';
import { must, useFocusLoad } from '@/lib/use-focus-load';

export default function Tracker() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: tracker, failed, reload } = useFocusLoad(
    async () => summarizeTracker(must(await supabase.from('trackers').select(TRACKER_COLUMNS).eq('id', id).single()) as TrackerRow, new Date()),
    id,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set when today is marked done from this screen, so its stamp drops in with a success tap.
  const [justDone, setJustDone] = useState(false);
  // Read synchronously, so a double tap can't send two changes.
  const inFlight = useRef(false);

  /** Runs one change, then reloads and moves tonight's reminder; a refusal shows as a plain sentence. */
  async function change(action: () => PromiseLike<{ error: { code?: string; message?: string } | null }>, done: string): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const { error } = await action();
    inFlight.current = false;
    setBusy(false);
    if (error) {
      const message = trackerErrorMessage(error);
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } else {
      AccessibilityInfo.announceForAccessibility(done);
    }
    reload();
    rescheduleShieldWarnings();
    return !error;
  }

  if (!tracker) return <LoadingScreen hero failed={failed} onRetry={reload} message="This tracker couldn’t be loaded." />;

  const log = (day: string) => change(() => supabase.from('tracker_days').insert({ tracker_id: id, day }), 'Marked done.');
  const undo = (day: string) => {
    setJustDone(false);
    return change(() => supabase.from('tracker_days').delete().eq('tracker_id', id).eq('day', day), 'Unmarked.');
  };
  const running = tracker.state === 'active' && !tracker.archived;

  function archive() {
    Alert.alert('Archive this tracker?', 'It stops reminding you and leaves your list. Its days are kept.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: () =>
          change(async () => {
            const result = await supabase.from('trackers').update({ archived_at: new Date().toISOString() }).eq('id', id);
            if (!result.error) router.back();
            return result;
          }, 'Archived.'),
      },
    ]);
  }

  const shieldsText = tracker.shields ? `, ${tracker.shieldsLeft} of ${tracker.shields} shields left` : '';
  const status = tracker.state === 'active' ? `Free tracker${shieldsText}` : trackerLine(tracker);
  // The ring: a goal's progress, or for a streak the share of this month's days so far that were done.
  const sofar = tracker.month.filter((d) => d.kind === 'done' || d.kind === 'missed' || d.kind === 'today');
  const monthDone = sofar.filter((d) => d.kind === 'done').length;
  const ring = tracker.goalDays ? tracker.daysDone / tracker.goalDays : sofar.length ? monthDone / sofar.length : 0;
  const monthName = fromDateString(tracker.today).toLocaleDateString(undefined, { month: 'long' });
  const words = { done: 'done', missed: 'not done', today: 'today, not done yet', ahead: 'to come', before: 'before you started' };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="automatic">
      <ChallengeHeader title={tracker.name} status={status} />

      <View style={styles.bento}>
        <Tile style={styles.hero}>
          <ProgressRing
            value={ring}
            size={104}
            stroke={11}
            color={colors.stamp}
            trackColor={colors.selected}
            accessibilityLabel={
              tracker.goalDays
                ? `${tracker.daysDone} of ${tracker.goalDays} days done`
                : `${tracker.daysDone} days tracked; ${monthDone} of ${sofar.length} days this month`
            }
          >
            <Text style={styles.number} maxFontSizeMultiplier={HERO_MAX_SCALE}>
              {tracker.daysDone}
            </Text>
          </ProgressRing>
          <Text style={styles.heroLabel}>{tracker.goalDays ? `of ${tracker.goalDays} days` : 'days tracked'}</Text>
        </Tile>
        <Tile style={styles.side}>
          <View accessible accessibilityLabel={`${tracker.streak} in a row, best ${tracker.best}`}>
            <Text style={styles.number} maxFontSizeMultiplier={HERO_MAX_SCALE}>
              {tracker.streak}
            </Text>
            <Text style={styles.sideLabel}>in a row</Text>
            <Text style={styles.caption}>best {tracker.best}</Text>
          </View>
          {tracker.doneToday && <BigStamp key={String(justDone)} color={colors.stamp} animate={justDone} size={48} />}
        </Tile>
      </View>

      <MonthCard
        title={monthName}
        days={tracker.month.map((d) => ({
          ...d,
          label: `${fromDateString(d.date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}: ${words[d.kind]}`,
        }))}
      />

      {running && (
        <View style={styles.buttons}>
          {tracker.doneToday ? (
            <Button title="Done today · Undo" onPress={() => undo(tracker.today)} disabled={busy} variant="secondary" />
          ) : (
            <Button title="Mark today done" onPress={async () => setJustDone(await log(tracker.today))} disabled={busy} />
          )}
          {tracker.canLogYesterday && !tracker.doneYesterday && (
            <Button title="I did it yesterday" onPress={() => log(tracker.yesterday)} disabled={busy} variant="link" />
          )}
        </View>
      )}
      <ErrorText message={error} />
      <Text style={styles.footer}>Free and private: only you see this, and nothing is checked. You can mark today or yesterday.</Text>

      {!tracker.archived && <Button title="Archive tracker" onPress={archive} variant="link" disabled={busy} />}
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: SCREEN,
    bento: { flexDirection: 'row', gap: SPACE.md },
    hero: { flex: 1.6, flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    heroLabel: { ...TEXT.row, flex: 1, color: c.secondaryText },
    side: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.xs },
    number: { ...TYPE.stat, color: c.text, textAlign: 'center' },
    sideLabel: { ...TEXT.row, color: c.secondaryText, textAlign: 'center' },
    caption: { ...TEXT.caption, color: c.secondaryText, textAlign: 'center' },
    buttons: { gap: SPACE.sm },
    footer: { ...TEXT.caption, color: c.secondaryText, marginHorizontal: SPACE.sm },
  });
