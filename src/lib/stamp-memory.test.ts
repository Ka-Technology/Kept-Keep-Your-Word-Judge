// Unit tests for stamp-memory.ts: which kept days a stamp strip stamps in as new (T98).
import AsyncStorage from '@react-native-async-storage/async-storage';

import { freshKept, takeFreshKept } from './stamp-memory';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(() => AsyncStorage.clear());

describe('freshKept', () => {
  it('stamps in only the days kept since the strip was last seen', () => {
    expect(freshKept([3, 4, 5], [3, 4])).toEqual([5]);
    expect(freshKept([3, 4], [3, 4])).toEqual([]);
  });

  it('replays nothing the first time, with no memory yet', () => {
    expect(freshKept([3, 4, 5], null)).toEqual([]);
  });
});

describe('takeFreshKept', () => {
  it('remembers each look, so a day approved in between stamps in once', async () => {
    expect(await takeFreshKept('c1', [1, 2])).toEqual([]);
    expect(await takeFreshKept('c1', [1, 2, 3])).toEqual([3]);
    expect(await takeFreshKept('c1', [1, 2, 3])).toEqual([]);
  });

  it('keeps each challenge apart', async () => {
    await takeFreshKept('c1', [1]);
    expect(await takeFreshKept('c2', [1, 2])).toEqual([]);
  });

  it('stamps nothing in, and doesn’t throw, when storage fails', async () => {
    await takeFreshKept('c1', [1]);
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await takeFreshKept('c1', [1, 2])).toEqual([]);
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage full'));
    await expect(takeFreshKept('c1', [1, 2, 3])).resolves.toEqual([3]);
  });
});
