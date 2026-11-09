// "About to lose a shield" (T35, SPEC-notifications.md section 5): which days get a warning, when it
// fires and what it says. A local notification at 8 pm in each challenge's own zone, on each day it
// has no check-in, for today and the next 6 days, so it still comes if Kept isn't opened. Challenges
// due at the same moment share one. Pure, so tested in shield-warnings.test.ts;
// notifications.ts schedules what this returns.

import { calendarDate } from './challenge-rules';
import type { ChallengeSummary } from './challenges';

export type WarningChallenge = Pick<ChallengeSummary, 'id' | 'title' | 'timeZone' | 'today' | 'daysRequired' | 'shieldsLeft' | 'state' | 'checkedInToday'>;
export type Warning = { at: Date; title: string; body: string; url: string };

export const WARNING_TITLE = 'Check in before midnight';
/** The Check in tab, where a tapped warning goes. */
export const WARNING_URL = '/check-in';

/** The local hour the warning fires: 4 hours before the midnight deadline. */
export const WARNING_HOUR = 20;
/** Today and the next 6 days. */
const DAYS_AHEAD = 7;
/** iOS keeps the 64 soonest scheduled notifications; stay under it. */
const MAX_WARNINGS = 60;

/** The warnings to schedule from `now`, soonest first. */
export function shieldWarnings(challenges: WarningChallenge[], now: Date): Warning[] {
  const due = new Map<number, WarningChallenge[]>();
  for (const c of challenges) {
    if (c.state !== 'active' && c.state !== 'upcoming') continue;
    const today = calendarDate(c.timeZone, now);
    for (let ahead = 0; ahead < DAYS_AHEAD; ahead++) {
      const day = c.today + ahead;
      // Before Day 1, or past the last day it can still need (more misses would add days later).
      if (day < 1 || day > c.daysRequired) continue;
      if (ahead === 0 && c.checkedInToday) continue;
      const at = zonedTime(addDays(today, ahead), WARNING_HOUR, c.timeZone).getTime();
      if (at <= now.getTime()) continue;
      due.set(at, [...(due.get(at) ?? []), c]);
    }
  }
  return [...due.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, MAX_WARNINGS)
    .map(([at, cs]) => ({ at: new Date(at), title: WARNING_TITLE, body: warningText(cs), url: WARNING_URL }));
}

/**
 * What a miss costs, as of scheduling: a shield, the last one, or (with none left) the challenge. Two
 * shields: a miss with one left breaks it and the challenge runs on (owner, 2026-10-01).
 */
const MISS_TEXT = (shieldsLeft: number) =>
  shieldsLeft === 0 ? 'Miss it and the challenge ends.' : shieldsLeft === 1 ? 'Miss it and you lose your last shield.' : 'Miss it and you lose a shield.';

/** "You haven’t checked in for Read today. Miss it and you lose a shield." */
export function warningText(cs: WarningChallenge[]): string {
  const names = cs.length === 1 ? cs[0].title : `${cs.slice(0, -1).map((c) => c.title).join(', ')} and ${cs[cs.length - 1].title}`;
  const miss = cs.length > 1 ? 'Miss them and you lose shields.' : MISS_TEXT(cs[0].shieldsLeft);
  return `You haven’t checked in for ${names} today. ${miss}`;
}

/** YYYY-MM-DD plus `days`. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The moment it's `hour`:00 on `date` in `timeZone`, daylight saving included. Also the trackers' reminder time. */
export function zonedTime(date: string, hour: number, timeZone: string): Date {
  const wall = Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
  // The zone's offset at a moment: its wall clock read as if it were UTC, minus the moment.
  const offset = (t: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(t));
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) - t;
  };
  // Twice, so a guess on the far side of a clock change settles on the right offset.
  const first = wall - offset(wall);
  return new Date(wall - offset(first));
}
