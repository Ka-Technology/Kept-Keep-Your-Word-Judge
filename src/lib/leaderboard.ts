// The Friends tab's leaderboard (T89, plan.md decision 88; SPEC-friends.md): you and your friends on
// three boards: days kept (this week, from Monday, or all time), streak (kept days in a row on one
// running challenge) and badges. Worked out from challenges friends can already read, so only staked
// challenges count (free trackers are private) and no amount is shown. Pure (leaderboard.test.ts).

import { calendarDate, UNDER_REVIEW, type CheckInStatus } from './challenge-rules';
import type { ChallengeSummary } from './challenges';

/** Which board: days kept this week or all time, the current streak, or badges earned. */
export type Board = 'week' | 'all' | 'streak' | 'badges';

/** What the board reads of a challenge. */
type Days = Pick<ChallengeSummary, 'state' | 'today' | 'days' | 'timeZone'>;

/** One person on the board, with their challenges and how many badges they've earned. */
export type Person = { id: string; username: string; avatarPath: string | null; me: boolean; challenges: ChallengeSummary[]; badges: number };

/** A row of the board: the person, their number on it, and their place (ties share it). */
export type BoardRow = Omit<Person, 'challenges' | 'badges'> & { value: number; rank: number };

/**
 * Whether a day counts as kept, as the rules count it (progress()): approved or excused, or an ended
 * day still being checked, which is Kept's job. Today waits until it's decided.
 */
export function isKept(day: number, status: CheckInStatus, today: number): boolean {
  return status === 'approved' || status === 'excused' || (day < today && UNDER_REVIEW.includes(status));
}

const counted = (challenges: Days[]) => challenges.filter((c) => c.state !== 'cancelled');
const keptDays = (c: Days, from = 1) => c.days.filter((d) => d.day >= from && d.day <= c.today && isKept(d.day, d.status, c.today)).length;

/** Kept days across every staked challenge, ended ones included (a cancelled one never counts). */
export function daysKept(challenges: Days[]): number {
  return counted(challenges).reduce((sum, c) => sum + keptDays(c), 0);
}

/** Kept days from this Monday to today, each challenge's week in its own time zone. */
export function daysKeptThisWeek(challenges: Days[], now: Date): number {
  return counted(challenges).reduce((sum, c) => {
    const weekday = new Date(`${calendarDate(c.timeZone, now)}T00:00:00Z`).getUTCDay();
    const sinceMonday = (weekday + 6) % 7;
    return sum + keptDays(c, c.today - sinceMonday);
  }, 0);
}

/**
 * The best run of kept days in a row on a running challenge, counted back from today: today adds
 * one once it's kept and doesn't break the run while it's still open; any other missed day does.
 */
export function currentStreak(challenges: Days[]): number {
  return Math.max(
    0,
    ...challenges
      .filter((c) => c.state === 'active')
      .map((c) => {
        const statusOn = new Map(c.days.map((d) => [d.day, d.status]));
        let run = 0;
        for (let day = c.today; day >= 1; day--) {
          const status = statusOn.get(day);
          if (status && isKept(day, status, c.today)) run++;
          else if (day === c.today && status !== 'rejected' && status !== 'appealed') continue;
          else break;
        }
        return run;
      }),
  );
}

/** The board, highest first (ties by username), with each person's place: 5, 5, 3 are 1st, 1st, 3rd. */
export function boardRows(people: Person[], board: Board, now: Date): BoardRow[] {
  const valueOf = (p: Person) =>
    board === 'week' ? daysKeptThisWeek(p.challenges, now) : board === 'all' ? daysKept(p.challenges) : board === 'streak' ? currentStreak(p.challenges) : p.badges;
  const rows = people.map((p) => ({ id: p.id, username: p.username, avatarPath: p.avatarPath, me: p.me, value: valueOf(p) }));
  return rows
    .map((r) => ({ ...r, rank: 1 + rows.filter((o) => o.value > r.value).length }))
    .sort((a, b) => b.value - a.value || a.username.localeCompare(b.username));
}

/** A board's number in words: "12 days", "5 in a row", "1 badge". */
export function valueText(board: Board, n: number): string {
  if (board === 'streak') return `${n} in a row`;
  if (board === 'badges') return `${n} ${n === 1 ? 'badge' : 'badges'}`;
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

/** A place in English: 1st, 2nd, 3rd, 4th, 11th, 21st. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/**
 * Where you stand, for the line over the board (A3, T107): "You're 2nd", or who shares your place
 * ("You and @taylor share 1st", "You and 2 others share 1st"). Null when you aren't on the board.
 */
export function boardSummary(rows: BoardRow[]): string | null {
  const me = rows.find((r) => r.me);
  if (!me) return null;
  const sharing = rows.filter((r) => !r.me && r.rank === me.rank);
  if (sharing.length === 0) return `You’re ${ordinal(me.rank)}`;
  const who = sharing.length === 1 ? `@${sharing[0].username}` : `${sharing.length} others`;
  return `You and ${who} share ${ordinal(me.rank)}`;
}
