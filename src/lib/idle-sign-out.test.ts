// Unit tests for idle-sign-out.ts: Kept signs out after 30 days unused (T87, plan.md decision 86).
import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearActive, IDLE_LIMIT_MS, idleTooLong, lastActive, markActive } from './idle-sign-out';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(() => AsyncStorage.clear());

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 17, 12);

describe('idleTooLong', () => {
  it('is 30 days', () => {
    expect(IDLE_LIMIT_MS).toBe(30 * DAY);
  });

  it('keeps someone signed in who opened Kept exactly 30 days ago', () => {
    expect(idleTooLong(NOW - 30 * DAY, NOW)).toBe(false);
  });

  it('signs out someone away for longer than 30 days', () => {
    expect(idleTooLong(NOW - 30 * DAY - 1, NOW)).toBe(true);
  });

  it('keeps someone signed in who opened Kept today', () => {
    expect(idleTooLong(NOW - 60_000, NOW)).toBe(false);
  });

  it('counts no record as active: a fresh sign-in, or a phone that never recorded one', () => {
    expect(idleTooLong(null, NOW)).toBe(false);
  });
});

describe('the last-open record', () => {
  it('starts empty', async () => {
    expect(await lastActive()).toBeNull();
  });

  it('remembers when Kept was last open', async () => {
    await markActive(NOW);
    expect(await lastActive()).toBe(NOW);
  });

  it('is cleared at a sign-out, so the next sign-in starts fresh', async () => {
    await markActive(NOW - 40 * DAY);
    await clearActive();
    expect(await lastActive()).toBeNull();
  });

  it('reads a damaged record as none', async () => {
    await AsyncStorage.setItem('kept.lastActive', 'not a time');
    expect(await lastActive()).toBeNull();
  });
});
