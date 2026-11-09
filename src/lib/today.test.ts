// Pins the Check in and Home rules (owner interview, 2026-09-27; A3, T100): the real time left
// before midnight in a challenge's own zone, the words for it, the challenge Home features, its
// greeting, the last seven days for a challenge's stamp strip and their weekdays, and which habits
// can open their check straight away.

import type { ChallengeSummary } from './challenges';
import { autoStart, dayWeekday, dueSoonest, featuredChallenge, greeting, greetingName, minutesToMidnight, recentStamps, timeLeft, todayAction } from './today';

const summary = (over: Partial<ChallengeSummary>): ChallengeSummary => ({
  id: 'c1', habitId: 'read', title: 'Read', charityName: 'Oceana', stakeDollars: 25, paymentName: 'Card', isPublic: false, lengthDays: 28,
  startDate: '2026-09-01', timeZone: 'UTC', today: 5, daysCompleted: 4, daysRequired: 28, shieldsLeft: 2, shieldsTotal: 2, missedDays: [], boughtShields: 0, revival: null, underReview: false, state: 'active', endedOnDay: null, quit: false,
  checkedInToday: false, todayText: null, days: [], ...over,
});

describe('minutesToMidnight (the real deadline, in the challenge’s own time zone)', () => {
  it('counts down to local midnight', () => {
    // 18:40 UTC is 11:40 in Los Angeles (PDT): 12h 20m left.
    expect(minutesToMidnight('America/Los_Angeles', new Date('2026-09-27T18:40:00Z'))).toBe(12 * 60 + 20);
    // The same moment is 03:40 the next day in Seoul: 20h 20m left.
    expect(minutesToMidnight('Asia/Seoul', new Date('2026-09-27T18:40:00Z'))).toBe(20 * 60 + 20);
  });
});

describe('timeLeft', () => {
  it('says how long is left, in hours and minutes', () => {
    expect(timeLeft(5 * 60 + 20)).toBe('5h 20m left');
    expect(timeLeft(3 * 60)).toBe('3h left');
    expect(timeLeft(45)).toBe('45m left');
    expect(timeLeft(0)).toBe('under a minute left');
  });
});

describe('featuredChallenge (the one challenge Home’s wide tile is about, T100)', () => {
  const now = new Date('2026-09-27T18:40:00Z');
  const redo = summary({ id: 'redo', timeZone: 'Asia/Seoul', checkedInToday: true, days: [{ day: 5, status: 'retake', text: 'Kept’s AI asked for a new photo' }] });
  const soon = summary({ id: 'soon', timeZone: 'America/Los_Angeles' });
  const later = summary({ id: 'later', timeZone: 'Asia/Seoul' });
  const appeal = summary({ id: 'appeal', checkedInToday: true, days: [{ day: 5, status: 'rejected', text: 'Not approved' }] });
  const kept = summary({ id: 'kept', checkedInToday: true, days: [{ day: 5, status: 'approved', text: 'Approved' }] });
  const upcoming = summary({ id: 'upcoming', state: 'upcoming', today: 0 });

  it('leads with a check-in to redo, then the soonest one due, with its minutes left', () => {
    expect(featuredChallenge([later, soon, redo], now)).toMatchObject({ challenge: { id: 'redo' }, action: 'redo' });
    expect(featuredChallenge([later, soon], now)).toEqual({ challenge: soon, action: 'check-in', minutes: 12 * 60 + 20 });
  });

  it('with nothing due: one to appeal, then the first running, then one about to start', () => {
    expect(featuredChallenge([kept, appeal], now)).toEqual({ challenge: appeal, action: 'appeal', minutes: null });
    expect(featuredChallenge([upcoming, kept], now)).toEqual({ challenge: kept, action: null, minutes: null });
    expect(featuredChallenge([upcoming], now)).toEqual({ challenge: upcoming, action: null, minutes: null });
  });

  it('is null with nothing running', () => {
    expect(featuredChallenge([summary({ state: 'finished' })], now)).toBeNull();
  });
});

describe('greeting (Home, T100)', () => {
  it('says good morning, afternoon or evening by the hour', () => {
    expect([5, 11].map(greeting)).toEqual(['Good morning', 'Good morning']);
    expect([12, 16].map(greeting)).toEqual(['Good afternoon', 'Good afternoon']);
    expect([17, 23, 0, 4].map(greeting)).toEqual(['Good evening', 'Good evening', 'Good evening', 'Good evening']);
  });
});

describe('greetingName (Home, T146, decision 101)', () => {
  const sam = { first_name: 'Sam', username: 'sam_reads' };

  it('greets by first name unless the user chose their username', () => {
    expect(greetingName(sam, 'name')).toBe('Sam');
    expect(greetingName(sam, 'username')).toBe('sam_reads');
  });

  it('uses the username while an account from before has no name', () => {
    expect(greetingName({ first_name: null, username: 'sam_reads' }, 'name')).toBe('sam_reads');
  });
});

describe('dayWeekday (the label under each of Home’s stamps, T100)', () => {
  it('names the weekday a challenge’s day falls on', () => {
    // Day 1 is Tuesday, September 1, 2026.
    expect(dayWeekday('2026-09-01', 1, 'en-US')).toBe('Tue');
    expect(dayWeekday('2026-09-01', 6, 'en-US')).toBe('Sun');
    expect(dayWeekday('2026-09-01', 7, 'en-US')).toBe('Mon');
  });
});

describe('todayAction (what today’s check-in needs from the challenger)', () => {
  const today = (status: 'pending' | 'flagged' | 'retake' | 'approved' | 'rejected' | 'appealed') =>
    summary({ checkedInToday: true, days: [{ day: 5, status, text: status }] });

  it('asks for a check-in when there’s none today', () => {
    expect(todayAction(summary({}))).toBe('check-in');
  });

  it('asks to do it again when a friend or Kept’s AI wants a new one', () => {
    expect(todayAction(today('flagged'))).toBe('redo');
    expect(todayAction(today('retake'))).toBe('redo');
  });

  it('offers an appeal once today’s check-in wasn’t approved', () => {
    expect(todayAction(today('rejected'))).toBe('appeal');
  });

  it('asks nothing while it waits for review, after approval, or during an appeal', () => {
    expect(todayAction(today('pending'))).toBeNull();
    expect(todayAction(today('approved'))).toBeNull();
    expect(todayAction(today('appealed'))).toBeNull();
  });

  it('asks nothing of a challenge that isn’t running today', () => {
    expect(todayAction(summary({ state: 'upcoming', today: 0 }))).toBeNull();
    expect(todayAction(summary({ state: 'finished' }))).toBeNull();
  });
});

describe('dueSoonest (Home’s hero and the next check-in pill)', () => {
  it('lists only active challenges not checked in today, the nearest midnight first', () => {
    const now = new Date('2026-10-02T20:00:00Z');
    const due = dueSoonest(
      [
        summary({ id: 'la', timeZone: 'America/Los_Angeles' }),
        summary({ id: 'utc', timeZone: 'UTC' }),
        summary({ id: 'done', checkedInToday: true }),
        summary({ id: 'soon', state: 'upcoming', today: 0 }),
      ],
      now,
    );
    expect(due.map((d) => d.challenge.id)).toEqual(['utc', 'la']);
    expect(due[0].minutes).toBe(4 * 60);
  });

  it('brings back a check-in to redo, marked as a redo, but not one that wasn’t approved', () => {
    const now = new Date('2026-10-02T20:00:00Z');
    const due = dueSoonest(
      [
        summary({ id: 'redo', checkedInToday: true, days: [{ day: 5, status: 'retake', text: 'Kept’s AI asked for a new photo' }] }),
        summary({ id: 'rejected', checkedInToday: true, days: [{ day: 5, status: 'rejected', text: 'Not approved' }] }),
        summary({ id: 'new' }),
      ],
      now,
    );
    expect(due.map((d) => [d.challenge.id, d.action])).toEqual([
      ['redo', 'redo'],
      ['new', 'check-in'],
    ]);
  });
});

describe('recentStamps (a challenge’s last seven days, up to today)', () => {
  it('ends at today and holds at most seven days', () => {
    const c = summary({ today: 9, days: [{ day: 8, status: 'approved', text: 'Approved' }] });
    const days = recentStamps(c);
    expect(days.map((d) => d.day)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(days.at(-2)?.kind).toBe('kept');
    expect(days.at(-1)?.kind).toBe('today');
  });

  it('is empty before Day 1', () => {
    expect(recentStamps(summary({ state: 'upcoming', today: 0 }))).toEqual([]);
  });
});

describe('autoStart (one tap opens the habit’s own check)', () => {
  it('opens Kept’s camera, or the screenshot picker, when that is the only way to check in', () => {
    expect(autoStart('workout')).toBe('camera');
    expect(autoStart('meditate')).toBe('screenshot');
  });

  it('leaves the choice or the typing to the check-in screen', () => {
    expect(autoStart('read')).toBeNull(); // the book and pages come first
    expect(autoStart('walk-run')).toBeNull(); // a photo or a screenshot
    expect(autoStart('language')).toBeNull(); // no photo; the quiz
  });
});
