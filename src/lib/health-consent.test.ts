// The separate consent for health habits (T179, plan.md decision 119; the privacy policy's "Consumer health data").
import { healthChoiceSummary, healthGate, healthHabitNamed, isHealthHabit } from './health-consent';

describe('health habits', () => {
  it('are the body, food and calm-body ones the privacy policy names', () => {
    for (const id of ['workout', 'walk-run', 'steps', 'bike', 'stretch', 'cook', 'greens', 'meditate']) expect(isHealthHabit(id)).toBe(true);
    for (const id of ['read', 'language', 'study', 'leetcode', 'chess', 'journal', 'instrument', 'draw']) expect(isHealthHabit(id)).toBe(false);
  });

  it('are found in a tracker’s name when it’s one of Kept’s health habits', () => {
    const habits = [
      { id: 'workout', name: 'Work out' },
      { id: 'read', name: 'Read' },
    ];
    expect(healthHabitNamed(' work out ', habits)).toBe(true);
    expect(healthHabitNamed('Read', habits)).toBe(false);
    expect(healthHabitNamed('Practice piano', habits)).toBe(false);
  });
});

describe('healthGate', () => {
  it('asks once, then lets a yes through and stops a no', () => {
    expect(healthGate(null)).toBe('ask');
    expect(healthGate(true)).toBe('ok');
    expect(healthGate(false)).toBe('blocked');
  });

  it('says where the person stands, for Settings', () => {
    expect(healthChoiceSummary(null)).toBe('You’ll be asked before your first challenge or tracker with a health habit.');
    expect(healthChoiceSummary(true)).toMatch(/^Kept keeps what you add to health habits/);
    expect(healthChoiceSummary(false)).toMatch(/^Health habits are off/);
  });
});
