// Unit tests for tutorial.ts: the per-user "seen the first-run tutorial" flag.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { hasSeenTutorial, markTutorialSeen } from './tutorial';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(() => AsyncStorage.clear());

describe('tutorial seen flag', () => {
  it('is unseen for a user who has never finished or skipped it', async () => {
    expect(await hasSeenTutorial('user-a')).toBe(false);
  });

  it('stays seen once marked', async () => {
    await markTutorialSeen('user-a');
    expect(await hasSeenTutorial('user-a')).toBe(true);
  });

  it('is kept per user, so a second account on the phone still sees it', async () => {
    await markTutorialSeen('user-a');
    expect(await hasSeenTutorial('user-b')).toBe(false);
  });

  it('counts as seen when storage fails, so a broken store never shows it on every launch', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await hasSeenTutorial('user-a')).toBe(true);
  });

  it('does not throw when saving fails', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage full'));
    await expect(markTutorialSeen('user-a')).resolves.toBeUndefined();
  });
});
