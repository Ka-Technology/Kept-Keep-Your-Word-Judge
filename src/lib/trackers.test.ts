// Unit tests for trackers.ts (free habit trackers; owner, 2026-10-01): streaks, shields, goals,
// the form's rules and the 8 pm reminder.
import {
  summarizeTracker,
  TRACKER_QUICK_PICKS,
  trackerError,
  trackerErrorMessage,
  trackerLine,
  trackerReminders,
  trackerSuggestions,
  type TrackerRow,
} from './trackers';

describe('Track a habit: five quick picks and Other (T216)', () => {
  const habits = [
    { id: 'read', name: 'Read' },
    { id: 'walk-run', name: 'Walk or run' },
    { id: 'stretch', name: 'Stretch or yoga' },
    { id: 'steps', name: '10,000 steps' },
  ];

  it('offers five of Kept’s habits as tiles, so Other fills the last of two rows of three', () => {
    expect(TRACKER_QUICK_PICKS).toEqual(['read', 'walk-run', 'meditate', 'journal', 'workout']);
  });

  it('suggests nothing until something is typed', () => {
    expect(trackerSuggestions('', habits)).toEqual([]);
    expect(trackerSuggestions('  ', habits)).toEqual([]);
  });

  it('suggests Kept’s habits that contain what’s typed, in any case', () => {
    expect(trackerSuggestions('STRE', habits).map((h) => h.id)).toEqual(['stretch']);
    expect(trackerSuggestions('r', habits).map((h) => h.id)).toEqual(['read', 'walk-run', 'stretch']);
  });

  it('finds Stretch or yoga by name now that it isn’t a tile', () => {
    expect(trackerSuggestions('yoga', habits).map((h) => h.id)).toEqual(['stretch']);
  });
});

// Noon UTC on Oct 10, 2026: today is 2026-10-10 in UTC.
const now = new Date('2026-10-10T12:00:00Z');

/** A UTC tracker that began Oct 1, done on the given days of October. */
function tracker(days: number[], over: Partial<TrackerRow> = {}): TrackerRow {
  return {
    id: 't1', name: 'Floss', goal_days: null, shields: 0, time_zone: 'UTC', start_date: '2026-10-01', archived_at: null,
    tracker_days: days.map((d) => ({ day: `2026-10-${String(d).padStart(2, '0')}` })),
    ...over,
  };
}

describe('summarizeTracker: an open-ended streak', () => {
  it('counts the streak, and today not done yet doesn’t break it', () => {
    expect(summarizeTracker(tracker([7, 8, 9]), now)).toMatchObject({ streak: 3, best: 3, doneToday: false, state: 'active' });
    expect(summarizeTracker(tracker([7, 8, 9, 10]), now)).toMatchObject({ streak: 4, doneToday: true });
  });

  it('starts over after a missed day with no shields, keeping the best', () => {
    expect(summarizeTracker(tracker([1, 2, 3, 4, 6, 7]), new Date('2026-10-08T12:00:00Z'))).toMatchObject({ streak: 2, best: 4 });
    // Days 8 and 9 missed too: back to nothing.
    expect(summarizeTracker(tracker([1, 2, 3, 4, 6, 7]), now)).toMatchObject({ streak: 0, best: 4 });
  });

  it('a shield carries the streak over a missed day, and comes back when the streak restarts', () => {
    const one = summarizeTracker(tracker([1, 2, 4, 5], { shields: 1 }), new Date('2026-10-05T12:00:00Z'));
    expect(one).toMatchObject({ streak: 4, shieldsLeft: 0 });
    // Day 6 missed with none left: the streak restarts with its shield back, which day 7's miss breaks.
    const reset = summarizeTracker(tracker([1, 2, 4, 5, 8], { shields: 1 }), new Date('2026-10-08T12:00:00Z'));
    expect(reset).toMatchObject({ streak: 1, shieldsLeft: 0, best: 4 });
  });

  it('lets yesterday be logged, but not before the first day', () => {
    expect(summarizeTracker(tracker([]), now)).toMatchObject({ yesterday: '2026-10-09', canLogYesterday: true });
    expect(summarizeTracker(tracker([], { start_date: '2026-10-10' }), now).canLogYesterday).toBe(false);
  });

});

describe('summarizeTracker: a goal of N days (the challenge rules, without money)', () => {
  it('finishes on the goal', () => {
    expect(summarizeTracker(tracker([1, 2, 3, 4, 5], { goal_days: 5 }), now)).toMatchObject({ state: 'finished', daysDone: 5 });
  });

  it('ends on a miss with no shield left', () => {
    expect(summarizeTracker(tracker([1, 2], { goal_days: 30, shields: 1 }), now)).toMatchObject({ state: 'not_finished', daysDone: 2 });
  });

  it('says where it stands in a line', () => {
    expect(trackerLine(summarizeTracker(tracker([8, 9, 10], { goal_days: 30, shields: 3, start_date: '2026-10-08' }), now))).toBe('3 of 30 days, 3 shields left');
    expect(trackerLine(summarizeTracker(tracker([8, 9, 10], { goal_days: 30, shields: 3 }), now))).toBe('Ended after 0 of 30 days');
    expect(trackerLine(summarizeTracker(tracker([9, 10]), now))).toBe('2-day streak, best 2');
  });
});

describe('trackerError (the same rules as migration 0040)', () => {
  it('accepts a name with no goal and no shields', () => {
    expect(trackerError('No sugar', null, 0)).toBeNull();
  });

  it('refuses an empty, long or offensive name, a bad goal or too many shields', () => {
    expect(trackerError('  ', null, 0)).toBe('Name the habit you want to keep.');
    expect(trackerError('x'.repeat(41), null, 0)).toBe('Keep the name to 40 characters.');
    expect(trackerError('fuck sugar', null, 0)).not.toBeNull();
    expect(trackerError('Floss', 0, 0)).toBe('A goal is 1 to 365 days.');
    expect(trackerError('Floss', null, 4)).toBe('Pick 0 to 3 shields.');
  });

  it('turns database refusals into plain sentences', () => {
    expect(trackerErrorMessage({ code: '23514', message: 'tracker_day_not_allowed' })).toBe('You can mark only today or yesterday.');
    expect(trackerErrorMessage({})).toBe('Couldn’t reach Kept. Check your connection and try again.');
  });
});

describe('trackerReminders (8 pm, if today isn’t done)', () => {
  it('reminds tonight and the next 6 evenings, skipping today once it’s done', () => {
    expect(trackerReminders([summarizeTracker(tracker([]), now)], now)).toHaveLength(7);
    expect(trackerReminders([summarizeTracker(tracker([10]), now)], now)[0].at).toEqual(new Date('2026-10-11T20:00:00Z'));
  });

  it('shares one reminder between trackers due at the same moment', () => {
    const two = [summarizeTracker(tracker([]), now), summarizeTracker(tracker([], { id: 't2', name: 'Read' }), now)];
    expect(trackerReminders(two, now)[0].body).toBe('Floss and Read: did you keep it today? Tap Done in Kept.');
  });

  it('skips archived and ended trackers', () => {
    expect(trackerReminders([summarizeTracker(tracker([], { archived_at: '2026-10-05T00:00:00Z' }), now)], now)).toEqual([]);
  });
});

describe('summarizeTracker: this month, for the calendar card (T139)', () => {
  it('lists every day of the month: done, missed, today, ahead', () => {
    const { month } = summarizeTracker(tracker([1, 2, 4]), now);
    expect(month).toHaveLength(31);
    expect(month.slice(0, 4).map((d) => d.kind)).toEqual(['done', 'done', 'missed', 'done']);
    expect(month[9]).toEqual({ day: 10, date: '2026-10-10', kind: 'today' });
    expect(month[10].kind).toBe('ahead');
  });

  it('marks today done once it is, and leaves the days before the start blank', () => {
    const { month } = summarizeTracker(tracker([5, 10], { start_date: '2026-10-05' }), now);
    expect(month.slice(0, 5).map((d) => d.kind)).toEqual(['before', 'before', 'before', 'before', 'done']);
    expect(month[9].kind).toBe('done');
  });
});
