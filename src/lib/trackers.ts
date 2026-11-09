// Free habit trackers (owner, 2026-10-01; docs/specs/SPEC-trackers.md): no money, no photo, no AI,
// no friends, so nothing is checked and the user keeps themselves honest. A tracker is any habit
// they name, either an open-ended streak or a goal of N days, with 0 to 3 shields, and they tap
// Done for today or yesterday. A goal runs on the challenge rules (progress() in
// challenge-rules.ts, its days all "approved"); a streak's shields come back each time it restarts.
// Pure, so tested in trackers.test.ts; migration 0040 enforces the same limits.

import { calendarDate, progress, type Outcome } from './challenge-rules';
import { isObjectionable, OBJECTIONABLE_MESSAGE } from './moderation';
import { addDays, WARNING_HOUR, zonedTime } from './shield-warnings';

/** What a tracker's name, goal and shields may be (the trackers table's checks). */
export const TRACKER_LIMITS = { nameMax: 40, goalMax: 365, shieldsMax: 3 };

/** Track a habit's tiles (T216, decision 175): five of Kept's habits, and Other last, two rows of three. */
export const TRACKER_QUICK_PICKS = ['read', 'walk-run', 'meditate', 'journal', 'workout'];

/** Kept's habits whose name contains what's typed under Other, any case; none until something is typed. */
export function trackerSuggestions<H extends { name: string }>(typed: string, habits: H[]): H[] {
  const q = typed.trim().toLowerCase();
  return q ? habits.filter((h) => h.name.toLowerCase().includes(q)) : [];
}

/** A tracker as the app reads it, with the days it was done (YYYY-MM-DD). */
export type TrackerRow = {
  id: string;
  name: string;
  goal_days: number | null;
  shields: number;
  time_zone: string;
  start_date: string;
  archived_at: string | null;
  tracker_days: { day: string }[];
};

/** The columns (and logged days) that make a TrackerRow, for Supabase `select()`. */
export const TRACKER_COLUMNS = 'id, name, goal_days, shields, time_zone, start_date, archived_at, tracker_days(day)';

/** What the screens show for a tracker. */
export type TrackerSummary = {
  id: string;
  name: string;
  goalDays: number | null;
  timeZone: string;
  /** Today and yesterday in the tracker's zone (YYYY-MM-DD): the two days Done can log. */
  today: string;
  yesterday: string;
  doneToday: boolean;
  doneYesterday: boolean;
  /** Yesterday can still be logged: it wasn't before the tracker began. */
  canLogYesterday: boolean;
  /** The current streak (today counts once done; not yet done, it doesn't break it). */
  streak: number;
  best: number;
  daysDone: number;
  shields: number;
  shieldsLeft: number;
  /** A goal finishes or runs out of shields; a streak is always running. */
  state: Outcome;
  /** Every day of this month, for the calendar card (T139): blank before the start, then done or missed, today, and days ahead. */
  month: { day: number; date: string; kind: 'before' | 'done' | 'missed' | 'today' | 'ahead' }[];
  archived: boolean;
};

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Every date (YYYY-MM-DD) of the month `date` falls in. */
function monthOf(date: string): string[] {
  const first = `${date.slice(0, 8)}01`;
  const days = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => addDays(first, i));
}

/** Works out a tracker's streak, goal and shields at `now`. */
export function summarizeTracker(row: TrackerRow, now: Date): TrackerSummary {
  const today = calendarDate(row.time_zone, now);
  const yesterday = addDays(today, -1);
  const done = new Set(row.tracker_days.map((d) => d.day));
  // Day 1 is the start date, so today is day `todayNumber`.
  const todayNumber = daysBetween(row.start_date, today) + 1;

  let streak = 0;
  let best = 0;
  let left = row.shields;
  for (let n = 1; n <= todayNumber; n++) {
    if (done.has(addDays(row.start_date, n - 1))) {
      streak++;
      best = Math.max(best, streak);
    } else if (n < todayNumber) {
      // A missed day breaks a shield; with none left the streak starts over, shields and all.
      if (left > 0) left--;
      else {
        streak = 0;
        left = row.shields;
      }
    }
  }

  const goal =
    row.goal_days === null
      ? null
      : progress(
          {
            lengthDays: row.goal_days,
            stakeCents: 0,
            shields: row.shields,
            checkIns: [...done].map((date) => ({ day: daysBetween(row.start_date, date) + 1, status: 'approved' as const })),
          },
          todayNumber,
        );

  return {
    id: row.id,
    name: row.name,
    goalDays: row.goal_days,
    timeZone: row.time_zone,
    today,
    yesterday,
    doneToday: done.has(today),
    doneYesterday: done.has(yesterday),
    canLogYesterday: yesterday >= row.start_date,
    streak,
    best,
    daysDone: goal ? goal.daysCompleted : done.size,
    shields: row.shields,
    shieldsLeft: goal ? goal.shieldsLeft : left,
    state: goal ? goal.outcome : 'active',
    month: monthOf(today).map((date) => ({
      day: Number(date.slice(8)),
      date,
      kind: date < row.start_date ? 'before' : done.has(date) ? 'done' : date === today ? 'today' : date > today ? 'ahead' : 'missed',
    })),
    archived: row.archived_at !== null,
  };
}

/** Where a tracker stands, in one line: "12-day streak, best 20" or "12 of 30 days, 1 shield left". */
export function trackerLine(t: TrackerSummary): string {
  if (t.state === 'finished') return `Goal reached: ${t.goalDays} days`;
  if (t.state === 'not_finished') return `Ended after ${t.daysDone} of ${t.goalDays} days`;
  const shields = t.shields ? `, ${t.shieldsLeft} shield${t.shieldsLeft === 1 ? '' : 's'} left` : '';
  return t.goalDays === null ? `${t.streak}-day streak, best ${t.best}${shields}` : `${t.daysDone} of ${t.goalDays} days${shields}`;
}

/** Why a new tracker can't be saved, or null if it can (the same rules as migration 0040). */
export function trackerError(name: string, goalDays: number | null, shields: number): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Name the habit you want to keep.';
  if (trimmed.length > TRACKER_LIMITS.nameMax) return `Keep the name to ${TRACKER_LIMITS.nameMax} characters.`;
  if (isObjectionable(trimmed)) return OBJECTIONABLE_MESSAGE;
  if (goalDays !== null && (goalDays < 1 || goalDays > TRACKER_LIMITS.goalMax)) return `A goal is 1 to ${TRACKER_LIMITS.goalMax} days.`;
  if (shields < 0 || shields > TRACKER_LIMITS.shieldsMax) return `Pick 0 to ${TRACKER_LIMITS.shieldsMax} shields.`;
  return null;
}

/** A plain sentence for a refused tracker or logged day (never the raw database error). */
export function trackerErrorMessage(error: { code?: string; message?: string }): string {
  const message = error.message ?? '';
  if (message.includes('text_objectionable')) return OBJECTIONABLE_MESSAGE;
  if (message.includes('tracker_limit')) return 'You can keep up to 50 trackers. Archive one to start another.';
  if (message.includes('tracker_day_not_allowed')) return 'You can mark only today or yesterday.';
  if (error.code === '23505') return 'That day is already marked done.';
  if (!error.code) return 'Couldn’t reach Kept. Check your connection and try again.';
  return 'Kept couldn’t save that. Please try again.';
}

/**
 * The trackers to remind about at 8 pm (the shield warning's hour) on each of the next 7 days, from
 * `now`: running ones not done that day. Grouped by moment, soonest first, so trackers in one zone
 * share one reminder.
 */
export function trackerReminders(trackers: TrackerSummary[], now: Date): { at: Date; body: string }[] {
  const due = new Map<number, string[]>();
  for (const t of trackers) {
    if (t.archived || t.state !== 'active') continue;
    for (let ahead = 0; ahead < 7; ahead++) {
      if (ahead === 0 && t.doneToday) continue;
      const at = zonedTime(addDays(t.today, ahead), WARNING_HOUR, t.timeZone).getTime();
      if (at <= now.getTime()) continue;
      due.set(at, [...(due.get(at) ?? []), t.name]);
    }
  }
  return [...due.entries()].sort(([a], [b]) => a - b).map(([at, names]) => ({ at: new Date(at), body: trackerReminderText(names) }));
}

export const TRACKER_REMINDER_TITLE = 'Did you keep it today?';

/** "Floss and Read: did you keep it today? Tap Done in Kept." */
export function trackerReminderText(names: string[]): string {
  return `${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`}: did you keep it today? Tap Done in Kept.`;
}
