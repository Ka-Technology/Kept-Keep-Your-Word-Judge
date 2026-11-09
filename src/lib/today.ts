// The rules behind the Check in and Home screens (owner interview, 2026-09-27; A3, T100): the real
// time left before midnight in a challenge's own zone (never a countdown that resets), the one
// challenge Home features, its greeting, the last seven days for a challenge's stamp strip and their
// weekdays, and which habits can open their check straight away. Pure, so tested in today.test.ts.

import { evidenceFor } from './check-in';
import { stampDays, type ChallengeSummary, type StampKind } from './challenges';
import type { GreetBy } from './greet-by';

/**
 * Minutes until midnight in `timeZone`: the day's check-in deadline (SPEC-challenges.md).
 * ponytail: ignores a daylight-saving change during the evening, which moves midnight by an hour twice a year.
 */
export function minutesToMidnight(timeZone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return 24 * 60 - (get('hour') * 60 + get('minute'));
}

/** "5h 20m left", from the minutes left (Home's hero, the next check-in pill). */
export function timeLeft(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const left = minutes < 1 ? 'under a minute' : h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
  return `${left} left`;
}

/**
 * What today's check-in on a running challenge needs from the challenger (owner, 2026-10-02): a
 * check-in; a redo, once a friend or Kept's AI asked for a new one; an appeal, once it wasn't
 * approved; or nothing (it's waiting for review, approved, or being appealed). A redo is due again
 * like a check-in, and shows in red until it's done.
 */
export function todayAction(c: ChallengeSummary): 'check-in' | 'redo' | 'appeal' | null {
  if (c.state !== 'active') return null;
  if (!c.checkedInToday) return 'check-in';
  const status = c.days.find((d) => d.day === c.today)?.status;
  return status === 'flagged' || status === 'retake' ? 'redo' : status === 'rejected' ? 'appeal' : null;
}

/**
 * The running challenges still due today (a check-in, or one to redo), soonest deadline first, with
 * the minutes each has left: Check in, Home's hero and the floating next check-in pill.
 */
export function dueSoonest(
  challenges: ChallengeSummary[],
  now: Date,
): { challenge: ChallengeSummary; minutes: number; action: 'check-in' | 'redo' }[] {
  return challenges
    .flatMap((challenge) => {
      const action = todayAction(challenge);
      return action === 'check-in' || action === 'redo' ? [{ challenge, minutes: minutesToMidnight(challenge.timeZone, now), action }] : [];
    })
    .sort((a, b) => a.minutes - b.minutes);
}

/**
 * The one challenge Home's wide tile is about (A3, T100): a check-in to redo first, then the soonest
 * one due (with its minutes left), then one that wasn't approved (to appeal), then the first running
 * challenge (kept today), then one about to start. Null with nothing running.
 */
export function featuredChallenge(
  challenges: ChallengeSummary[],
  now: Date,
): { challenge: ChallengeSummary; action: ReturnType<typeof todayAction>; minutes: number | null } | null {
  const due = dueSoonest(challenges, now);
  const lead = due.find((d) => d.action === 'redo') ?? due[0];
  if (lead) return lead;
  const running = challenges.filter((c) => c.state === 'active' || c.state === 'upcoming');
  const pick = running.find((c) => todayAction(c) === 'appeal') ?? running.find((c) => c.state === 'active') ?? running[0];
  return pick ? { challenge: pick, action: todayAction(pick), minutes: null } : null;
}

/** Home's greeting by the hour of the day (0–23): morning until noon, afternoon until 5 pm, evening after. */
export function greeting(hour: number): string {
  return hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** Who Home greets (T146): the first name, unless the user chose their username or has no name yet. */
export function greetingName(profile: { first_name: string | null; username: string }, greetBy: GreetBy): string {
  return greetBy === 'name' && profile.first_name ? profile.first_name : profile.username;
}

/** The short weekday a challenge's `day` falls on ("Tue"), from its start date (Day 1), in the phone's language. */
export function dayWeekday(startDate: string, day: number, locale?: string): string {
  const [year, month, date] = startDate.split('-').map(Number);
  return new Date(year, month - 1, date + day - 1).toLocaleDateString(locale, { weekday: 'short' });
}

/** The last seven days of a challenge, up to today, for Home's stamp strip. Empty before Day 1. */
export function recentStamps(c: ChallengeSummary): { day: number; kind: StampKind; text: string }[] {
  return stampDays(c)
    .filter((d) => d.day <= c.today)
    .slice(-7);
}

/**
 * What one tap on a due check-in opens straight away: Kept's camera or the screenshot picker when
 * that is the habit's only way to check in. Null leaves it to the check-in screen: Read needs the
 * book and pages first, some habits offer a photo or a screenshot, and Learn a language has none.
 */
export function autoStart(habitId: string): 'camera' | 'screenshot' | null {
  if (habitId === 'read') return null;
  const evidence = evidenceFor(habitId);
  return evidence === 'camera' || evidence === 'screenshot' ? evidence : null;
}
