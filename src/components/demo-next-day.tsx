// "Next day (demo)" (T19): moves a challenge forward a day, as if midnight had passed. On the challenge's screen
// while it runs, and there and on its results once its misses ended it today, to reach tomorrow's shield offer. The
// server adds 1 to its stored `day_offset` (so it survives a relaunch), then runs the AI check on the day just ended,
// like a real deadline (T27); a day left without a check-in then counts as a miss. Remove with `day_offset`.

import { useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { demoClockCanMove, demoClockEnabled, type ChallengeSummary } from '@/lib/challenges';
import { rescheduleShieldWarnings } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { SPACE, TEXT, useStyles, type Colors } from '@/lib/theme';

export function DemoNextDay({ challenge, onMoved }: { challenge: ChallengeSummary; onMoved: () => void }) {
  const styles = useStyles(makeStyles);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read synchronously, so a double tap can't skip two days.
  const inFlight = useRef(false);
  if (!demoClockEnabled() || !demoClockCanMove(challenge)) return null;

  async function nextDay() {
    if (inFlight.current) return;
    inFlight.current = true;
    setMoving(true);
    setError(null);
    try {
      const { error } = await supabase.functions.invoke('ai-check', { body: { challengeId: challenge.id, nextDay: true } });
      if (error) throw error;
      AccessibilityInfo.announceForAccessibility(`Day ${challenge.today + 1}`);
    } catch {
      const message = 'Couldn’t move to the next day. Check your connection and try again.';
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      inFlight.current = false;
      setMoving(false);
      onMoved();
      // The demo clock moved the challenge's days, so its shield warnings move too (T35).
      rescheduleShieldWarnings();
    }
  }

  return (
    <View style={styles.block}>
      <Button title={moving ? 'Moving on…' : 'Next day (demo)'} onPress={nextDay} disabled={moving} variant="link" />
      <Text style={styles.note}>
        {challenge.state === 'not_finished'
          ? 'Demo only: moves to tomorrow, when you can buy a shield to keep this challenge going.'
          : 'Demo only: moves this challenge to tomorrow, as if midnight had passed.'}
      </Text>
      <ErrorText message={error} />
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    block: { gap: SPACE.sm },
    note: { ...TEXT.caption, color: c.secondaryText, textAlign: 'center' },
  });
