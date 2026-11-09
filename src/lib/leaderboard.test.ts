// Unit tests for leaderboard.ts: the Friends tab's board (T89, plan.md decision 88).
import type { CheckInStatus } from './challenge-rules';
import type { ChallengeSummary } from './challenges';
import { boardRows, boardSummary, currentStreak, daysKept, daysKeptThisWeek, isKept, ordinal, valueText, type Person } from './leaderboard';

type Days = Pick<ChallengeSummary, 'state' | 'today' | 'days' | 'timeZone'>;

/** A challenge on day `today` with these check-ins ({ day: status }). */
function challenge(today: number, statuses: Record<number, CheckInStatus>, state: ChallengeSummary['state'] = 'active', timeZone = 'UTC'): Days {
  const days = Object.entries(statuses).map(([day, status]) => ({ day: Number(day), status, text: '' }));
  return { state, today, days, timeZone };
}

// Wednesday 14 October 2026, noon UTC.
const WEDNESDAY = new Date('2026-10-14T12:00:00Z');

describe('isKept', () => {
  it('counts approved and excused days', () => {
    expect(isKept(3, 'approved', 5)).toBe(true);
    expect(isKept(3, 'excused', 5)).toBe(true);
  });

  it('counts an ended day still being checked, as the rules do (Kept’s job, not the challenger’s)', () => {
    expect(isKept(3, 'pending', 5)).toBe(true);
  });

  it('doesn’t count today while it’s still being checked', () => {
    expect(isKept(5, 'pending', 5)).toBe(false);
  });

  it('doesn’t count a rejected or appealed day', () => {
    expect(isKept(3, 'rejected', 5)).toBe(false);
    expect(isKept(3, 'appealed', 5)).toBe(false);
  });
});

describe('daysKept (all time)', () => {
  it('adds up the kept days of every challenge, ended ones included', () => {
    const running = challenge(4, { 1: 'approved', 2: 'approved', 3: 'rejected' });
    const finished = challenge(40, { 1: 'approved', 2: 'excused', 3: 'approved' }, 'finished');
    expect(daysKept([running, finished])).toBe(5);
  });

  it('leaves out a cancelled challenge', () => {
    expect(daysKept([challenge(1, { 1: 'approved' }, 'cancelled')])).toBe(0);
  });
});

describe('daysKeptThisWeek', () => {
  it('counts kept days from Monday to today', () => {
    // Day 10 is Wednesday, so Monday is day 8; day 7 was Sunday.
    const c = challenge(10, { 7: 'approved', 8: 'approved', 9: 'excused', 10: 'approved' });
    expect(daysKeptThisWeek([c], WEDNESDAY)).toBe(3);
  });

  it('starts again on Monday', () => {
    const monday = new Date('2026-10-12T12:00:00Z');
    const c = challenge(8, { 6: 'approved', 7: 'approved', 8: 'approved' });
    expect(daysKeptThisWeek([c], monday)).toBe(1);
  });

  it('uses each challenge’s own zone for the week', () => {
    // Sunday evening in UTC is already Monday morning in Auckland.
    const sunday = new Date('2026-10-18T20:00:00Z');
    const auckland = challenge(10, { 9: 'approved', 10: 'approved' }, 'active', 'Pacific/Auckland');
    expect(daysKeptThisWeek([auckland], sunday)).toBe(1);
  });

  it('counts ended challenges’ days that fell this week', () => {
    const ended = challenge(11, { 8: 'approved', 9: 'approved', 10: 'approved' }, 'finished');
    expect(daysKeptThisWeek([ended], WEDNESDAY)).toBe(2);
  });
});

describe('currentStreak', () => {
  it('counts kept days in a row up to yesterday while today is still open', () => {
    expect(currentStreak([challenge(6, { 1: 'approved', 2: 'approved', 3: 'approved', 4: 'approved', 5: 'approved' })])).toBe(5);
  });

  it('counts today once it’s kept', () => {
    expect(currentStreak([challenge(3, { 1: 'approved', 2: 'approved', 3: 'approved' })])).toBe(3);
  });

  it('starts again after a missed day', () => {
    expect(currentStreak([challenge(6, { 1: 'approved', 2: 'approved', 4: 'approved', 5: 'approved', 6: 'pending' })])).toBe(2);
  });

  it('is broken by a day that wasn’t approved today', () => {
    expect(currentStreak([challenge(3, { 1: 'approved', 2: 'approved', 3: 'rejected' })])).toBe(0);
  });

  it('takes the best running challenge and ignores ended ones', () => {
    const short = challenge(3, { 1: 'approved', 2: 'approved' });
    const long = challenge(5, { 1: 'approved', 2: 'approved', 3: 'approved', 4: 'approved' });
    const finished = challenge(40, { 38: 'approved', 39: 'approved', 40: 'approved' }, 'finished');
    expect(currentStreak([short, long, finished])).toBe(4);
  });

  it('is 0 with nothing running', () => {
    expect(currentStreak([])).toBe(0);
  });
});

describe('boardRows', () => {
  function person(username: string, badges: number, me = false, challenges: ChallengeSummary[] = []): Person {
    return { id: username, username, avatarPath: null, me, badges, challenges };
  }

  it('ranks by the board’s number, highest first, and ties share a rank', () => {
    const rows = boardRows([person('cam', 3), person('bea', 5), person('abe', 5, true)], 'badges', WEDNESDAY);
    expect(rows.map((r) => [r.username, r.value, r.rank])).toEqual([
      ['abe', 5, 1],
      ['bea', 5, 1],
      ['cam', 3, 3],
    ]);
  });

  it('keeps who is you', () => {
    const rows = boardRows([person('abe', 1), person('bea', 2, true)], 'badges', WEDNESDAY);
    expect(rows.find((r) => r.me)?.username).toBe('bea');
  });

  it('works out days kept and streaks from the challenges', () => {
    const c = challenge(3, { 1: 'approved', 2: 'approved' }) as ChallengeSummary;
    const [row] = boardRows([person('abe', 0, true, [c])], 'all', WEDNESDAY);
    expect(row.value).toBe(2);
    expect(boardRows([person('abe', 0, true, [c])], 'streak', WEDNESDAY)[0].value).toBe(2);
  });
});

describe('valueText', () => {
  it('says each board’s number in words', () => {
    expect(valueText('week', 1)).toBe('1 day');
    expect(valueText('all', 12)).toBe('12 days');
    expect(valueText('streak', 5)).toBe('5 in a row');
    expect(valueText('badges', 1)).toBe('1 badge');
    expect(valueText('badges', 9)).toBe('9 badges');
  });
});

describe('boardSummary (where you stand, over the board, T107)', () => {
  const row = (username: string, value: number, rank: number, me = false) => ({ id: username, username, avatarPath: null, me, value, rank });

  it('says your place, and who shares it', () => {
    expect(boardSummary([row('taylor', 7, 1), row('sam', 7, 1, true), row('alex', 5, 3)])).toBe('You and @taylor share 1st');
    expect(boardSummary([row('sam', 3, 1, true), row('a', 3, 1), row('b', 3, 1)])).toBe('You and 2 others share 1st');
    expect(boardSummary([row('a', 9, 1), row('sam', 7, 2, true)])).toBe('You’re 2nd');
  });

  it('is null when you aren’t on it', () => {
    expect(boardSummary([row('a', 9, 1)])).toBeNull();
  });
});

describe('ordinal', () => {
  it('writes places the English way', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '111th']);
  });
});
