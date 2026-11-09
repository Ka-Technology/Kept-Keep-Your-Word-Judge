// Unit tests for appearance.ts: the System / Light / Dark preference from Settings.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';

import { applyAppearance, loadAppearance, saveAppearance, setAppearanceCover, switchAppearance } from './appearance';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(() => AsyncStorage.clear());

describe('appearance preference', () => {
  it('is System until the user picks something', async () => {
    expect(await loadAppearance()).toBe('system');
  });

  it.each(['light', 'dark', 'system'] as const)('reads back a saved %s', async (preference) => {
    await saveAppearance(preference);
    expect(await loadAppearance()).toBe(preference);
  });

  it('falls back to System for anything unexpected in storage', async () => {
    await AsyncStorage.setItem('kept.appearance', 'sepia');
    expect(await loadAppearance()).toBe('system');
  });

  it('falls back to System when storage fails', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await loadAppearance()).toBe('system');
  });
});

describe('applyAppearance', () => {
  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    ['system', 'unspecified'],
  ] as const)('sets %s as the app color scheme %s', (preference, scheme) => {
    const setColorScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    applyAppearance(preference);
    expect(setColorScheme).toHaveBeenCalledWith(scheme);
  });
});

describe('switchAppearance (Settings → Appearance, with a soft change)', () => {
  afterEach(() => setAppearanceCover(null));

  it('switches the scheme while the screen is covered, then reveals it, and remembers the choice', async () => {
    const steps: string[] = [];
    jest.spyOn(Appearance, 'setColorScheme').mockImplementation((scheme) => void steps.push(`scheme ${scheme}`));
    setAppearanceCover(async () => {
      steps.push('cover');
      return () => steps.push('reveal');
    });
    await switchAppearance('dark');
    expect(steps).toEqual(['cover', 'scheme dark', 'reveal']);
    expect(await loadAppearance()).toBe('dark');
  });

  it('still switches when the screen can’t be covered', async () => {
    const setColorScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    setAppearanceCover(() => Promise.reject(new Error('capture failed')));
    await switchAppearance('light');
    expect(setColorScheme).toHaveBeenCalledWith('light');
  });

  it('switches straight away with no cover (web, Reduce Motion)', async () => {
    const setColorScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    await switchAppearance('system');
    expect(setColorScheme).toHaveBeenCalledWith('unspecified');
  });
});
