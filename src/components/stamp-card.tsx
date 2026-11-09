// The stamp card on a challenge's detail screen: every day of the challenge in rows of seven, a week
// each, each day's number above its mark (A3, T101). A kept day carries Kept's green day box with a K
// (decision 93); a missed one, the red box with an X; a day still being checked, a dashed box (red
// when a friend or Kept's AI asked for it again); today, a green outline; days to come, their number.
// Each has its own shape, so none relies on color alone, and VoiceOver reads each day in words. Tapping a day that has come opens its
// check-in (where a rejected day can be appealed, T29). Home's challenge cards show the last seven
// days with the same stamps (StampStrip, owner 2026-09-27); a day approved since the strip was last
// on screen stamps itself in (T98). A free tracker's month (MonthCard, T139) gets plain ticks
// instead (2026-10-02): nothing checks a tracker, so it doesn't get Kept's K.

import { SymbolView } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { DayStamp, useStampDown } from '@/components/big-stamp';
import { STAMP_WINDOW_WEEKS, stampDays, stampWindow, type ChallengeSummary, type StampKind } from '@/lib/challenges';
import { takeFreshKept } from '@/lib/stamp-memory';
import { FONTS, ICON, RADIUS, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { dayWeekday, recentStamps } from '@/lib/today';

type Day = { day: number; kind: StampKind; text: string };

/** A K box set down as it's first seen (T98): a day approved since the strip was last on screen. */
function FreshStamp({ color }: { color: string }) {
  const styles = useStyles(makeStyles);
  return (
    <Animated.View style={[styles.fresh, useStampDown(true)]}>
      <DayStamp kind="kept" color={color} size="100%" />
    </Animated.View>
  );
}

/** One day's mark: the K or X day box, or the day's number (outlined for today). */
function StampMark({ d, fresh = false }: { d: Day; fresh?: boolean }) {
  const c = useColors();
  const styles = useStyles(makeStyles);
  if (d.kind === 'kept' || d.kind === 'missed') {
    const color = d.kind === 'kept' ? c.stamp : c.error;
    if (fresh) return <FreshStamp color={color} />;
    return <DayStamp kind={d.kind} color={color} size="80%" />;
  }
  return (
    <Text style={[styles.number, d.kind === 'today' && styles.todayNumber, d.kind === 'redo' && styles.redoNumber]} allowFontScaling={false}>
      {d.day}
    </Text>
  );
}

/**
 * The days kept since this strip was last on screen on this phone (lib/stamp-memory.ts). Read after
 * the strip shows, so those stamps show for a moment, then lift and land again.
 */
function useFreshKept(challengeId: string, kept: number[]): number[] {
  const keptKey = kept.join(',');
  const [fresh, setFresh] = useState<number[]>([]);
  useEffect(() => {
    let current = true;
    takeFreshKept(challengeId, keptKey ? keptKey.split(',').map(Number) : []).then((days) => {
      if (current) setFresh(days);
    });
    return () => {
      current = false;
    };
  }, [challengeId, keptKey]);
  return fresh;
}

/**
 * A challenge's last seven days up to today, in one row, each with its weekday under it (A3, T100;
 * `numbers` puts the day's number there instead, as on the Challenges tab, T104):
 * a kept day's K box on a green wash, a miss's X box on a red wash, and a dashed box for today and
 * for a day still being checked (red for one to redo). Read by VoiceOver as one line.
 */
export function StampStrip({ challenge, numbers = false }: { challenge: ChallengeSummary; numbers?: boolean }) {
  const styles = useStyles(makeStyles);
  const days = recentStamps(challenge);
  const keptDays = days.filter((d) => d.kind === 'kept').map((d) => d.day);
  const fresh = useFreshKept(challenge.id, keptDays);
  if (days.length === 0) return null;
  return (
    <View style={styles.week} accessible accessibilityLabel={`Last ${days.length} days: ${keptDays.length} kept`}>
      {days.map((d) => (
        // A new key for a fresh day starts its stamp-down.
        <View key={fresh.includes(d.day) ? `${d.day}-fresh` : d.day} style={styles.column}>
          <View style={[styles.cell, styles.stripCell, d.kind === 'kept' ? styles.washKept : d.kind === 'missed' ? styles.washMissed : d.kind === 'today' ? styles.open : styles[d.kind]]}>
            {(d.kind === 'kept' || d.kind === 'missed') && <StampMark d={d} fresh={fresh.includes(d.day)} />}
          </View>
          <Text style={styles.weekday} allowFontScaling={false}>
            {numbers ? d.day : dayWeekday(challenge.startDate, d.day)}
          </Text>
        </View>
      ))}
      {Array.from({ length: 7 - days.length }, (_, i) => (
        <View key={`pad-${i}`} style={styles.pad} />
      ))}
    </View>
  );
}

/**
 * Every day of a challenge in rows of seven (A3, T101): each cell shows its day's number above its
 * mark, the K or X box; today's cell is outlined in green; a day still being checked is dashed (red
 * to redo); days to come show just their number. `title` heads the card ("Your days"), or `header`
 * does (a friend's challenge, T123), and `children` go under the days ("Back this challenge").
 * Without `onOpen` the days are only to read, not buttons. A challenge of more than four weeks shows four
 * at a time (stampWindow), today in the third row, with arrows to move through the rest, so the buttons
 * below it stay on screen.
 */
export function StampCard({
  challenge,
  onOpen,
  title,
  header,
  children,
}: {
  challenge: ChallengeSummary;
  onOpen?: (day: number) => void;
  title?: string;
  header?: ReactNode;
  children?: ReactNode;
}) {
  const c = useColors();
  const styles = useStyles(makeStyles);
  const days = stampDays(challenge);
  const allWeeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, w) => days.slice(w * 7, w * 7 + 7));
  // The user's own paging (a week to start at), until then the window follows today.
  const [startWeek, setStartWeek] = useState<number | null>(null);
  const ended = challenge.state === 'finished' || challenge.state === 'not_finished' || challenge.state === 'cancelled';
  const shown = stampWindow(days.length, ended ? days.length : challenge.today, startWeek);
  const weeks = allWeeks.slice(shown.startWeek, shown.startWeek + STAMP_WINDOW_WEEKS);
  const paged = allWeeks.length > STAMP_WINDOW_WEEKS;

  return (
    <View style={styles.card}>
      {title && (
        <Text style={styles.cardTitle} accessibilityRole="header">
          {title}
        </Text>
      )}
      {header}
      {paged && (
        <View style={styles.pager}>
          <Pressable onPress={() => setStartWeek(shown.startWeek - STAMP_WINDOW_WEEKS)} disabled={!shown.hasPrev} hitSlop={SPACE.sm} accessibilityRole="button" accessibilityLabel="Earlier days" style={!shown.hasPrev && styles.faint}>
            <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left' }} size={ICON.row} tintColor={c.text} />
          </Pressable>
          <Text style={styles.pagerText} accessibilityLiveRegion="polite">
            Days {shown.from}–{shown.to} of {days.length}
          </Text>
          <Pressable onPress={() => setStartWeek(shown.startWeek + STAMP_WINDOW_WEEKS)} disabled={!shown.hasNext} hitSlop={SPACE.sm} accessibilityRole="button" accessibilityLabel="Later days" style={!shown.hasNext && styles.faint}>
            <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right' }} size={ICON.row} tintColor={c.text} />
          </Pressable>
        </View>
      )}
      {weeks.map((week, w) => (
        <View key={w} style={styles.week}>
          {week.map((d) => {
            const isToday = challenge.state === 'active' && d.day === challenge.today;
            return (
              <Pressable
                key={d.day}
                style={({ pressed }) => [styles.dayCell, (d.kind === 'open' || d.kind === 'redo') && styles[d.kind], isToday && styles.todayCell, pressed && !!onOpen && styles.pressed]}
                onPress={onOpen && (() => onOpen(d.day))}
                // About 38 pt wide on a 375 pt phone; 4 pt each side (half the gap) makes the target 44+.
                hitSlop={SPACE.xs}
                disabled={!onOpen || d.kind === 'ahead'}
                accessibilityRole={onOpen ? 'button' : 'text'}
                accessibilityLabel={`Day ${d.day}: ${d.text}`}
                accessibilityState={onOpen ? { disabled: d.kind === 'ahead' } : undefined}
              >
                <Text style={[styles.dayNumber, isToday && styles.todayDayNumber, d.kind === 'redo' && styles.redoNumber]} allowFontScaling={false}>
                  {d.day}
                </Text>
                {(d.kind === 'kept' || d.kind === 'missed') && (
                  <View style={styles.mark}>
                    <DayStamp kind={d.kind} color={d.kind === 'kept' ? c.stamp : c.error} size="100%" />
                  </View>
                )}
              </Pressable>
            );
          })}
          {/* Keeps the last week's days the same size as the rest. */}
          {Array.from({ length: 7 - week.length }, (_, i) => (
            <View key={`pad-${i}`} style={styles.pad} />
          ))}
        </View>
      ))}
      {children}
    </View>
  );
}

/**
 * A month as a calendar card (A3, T139, a free tracker): the month's name, then its days in rows of
 * seven, each its number over a plain green tick on a green wash when done (not Kept's K: nothing
 * checks a tracker); today outlined in green, days to come faint, misses blank. Not tappable; each
 * day reads its own label.
 */
export function MonthCard({ title, days }: { title: string; days: { day: number; kind: 'before' | 'done' | 'missed' | 'today' | 'ahead'; label: string }[] }) {
  const c = useColors();
  const styles = useStyles(makeStyles);
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, w) => days.slice(w * 7, w * 7 + 7));
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} accessibilityRole="header">
        {title}
      </Text>
      {weeks.map((week, w) => (
        <View key={w} style={styles.week}>
          {week.map((d) => (
            <View
              key={d.day}
              style={[styles.dayCell, d.kind === 'done' && styles.tick, d.kind === 'today' && styles.todayCell, (d.kind === 'ahead' || d.kind === 'before') && styles.faint]}
              accessible
              accessibilityLabel={d.label}
            >
              <Text style={[styles.dayNumber, d.kind === 'today' && styles.todayDayNumber]} allowFontScaling={false}>
                {d.day}
              </Text>
              {d.kind === 'done' && (
                <View style={styles.tickMark}>
                  <SymbolView name={{ ios: 'checkmark', android: 'check' }} size={ICON.row} weight="bold" tintColor={c.stamp} />
                </View>
              )}
            </View>
          ))}
          {Array.from({ length: 7 - week.length }, (_, i) => (
            <View key={`pad-${i}`} style={styles.pad} />
          ))}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: RADIUS.tile, padding: SPACE.lg, gap: SPACE.sm, boxShadow: c.tileShadow || undefined },
    cardTitle: { ...TYPE.title, color: c.text, marginBottom: SPACE.sm },
    // The challenge's day grid (T101): the number above the mark, in an outlined cell, with room
    // under the mark (owner, 2026-10-18: it sat on the cell's bottom edge). The mark takes what's left.
    dayCell: {
      flex: 1,
      aspectRatio: 0.75,
      borderRadius: RADIUS.field,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: c.separator,
      alignItems: 'center',
      paddingTop: SPACE.xs,
      paddingBottom: SPACE.sm,
      gap: SPACE.xxs,
    },
    todayCell: { borderWidth: 2, borderColor: c.stamp },
    dayNumber: { fontFamily: FONTS.heading, fontSize: 12, color: c.secondaryText },
    todayDayNumber: { color: c.stamp, fontFamily: FONTS.heavy },
    mark: { flex: 1, aspectRatio: 1 },
    pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    pagerText: { ...TEXT.note, color: c.secondaryText },
    faint: { opacity: 0.5 },
    week: { flexDirection: 'row', gap: SPACE.sm },
    cell: { flex: 1, aspectRatio: 1, borderRadius: RADIUS.small, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
    pad: { flex: 1 },
    // Home's strip (T100): a column per day, the cell over its weekday.
    column: { flex: 1, alignItems: 'center', gap: SPACE.xs },
    stripCell: { alignSelf: 'stretch', borderRadius: RADIUS.small + 4 },
    washKept: { backgroundColor: c.selected },
    washMissed: { backgroundColor: c.alertWash },
    weekday: { ...TEXT.caption, color: c.secondaryText },
    // The day box is its own outline.
    kept: {},
    fresh: { width: '80%', height: '80%' },
    missed: {},
    // A tracker's done and missed days.
    tick: { backgroundColor: c.selected },
    tickMark: { flex: 1, justifyContent: 'center' },
    open: { borderWidth: 1.5, borderColor: c.secondaryText, borderStyle: 'dashed' },
    redo: { borderWidth: 1.5, borderColor: c.error, borderStyle: 'dashed', backgroundColor: c.alertWash },
    today: { borderWidth: 2, borderColor: c.text },
    ahead: { backgroundColor: c.background },
    pressed: { opacity: 0.7 },
    number: { fontFamily: FONTS.heading, fontSize: 13, color: c.secondaryText },
    todayNumber: { color: c.text },
    redoNumber: { color: c.error, fontFamily: FONTS.heavy },
  });
