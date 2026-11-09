// The Appearance setting (Settings → Appearance): System, Light or Dark, remembered on this device.
// System follows the phone; Light and Dark override it app-wide through React Native's Appearance.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';

export type AppearancePreference = 'system' | 'light' | 'dark';

const KEY = 'kept.appearance';

/** The saved preference, or System if there's none (or storage can't be read). */
export async function loadAppearance(): Promise<AppearancePreference> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

/** Makes the whole app light, dark, or follow the phone again. */
export function applyAppearance(preference: AppearancePreference): void {
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
}

/**
 * Covers the screen with a still of itself and resolves to what fades it away, or to nothing when
 * there's nothing to cover. Set by components/theme-fade.tsx; null on web and with Reduce Motion.
 */
type Cover = () => Promise<(() => void) | void>;

let cover: Cover | null = null;

/** Sets (or clears) what switchAppearance() covers the screen with. */
export function setAppearanceCover(next: Cover | null): void {
  cover = next;
}

/**
 * Settings → Appearance's switch: the colors change under a still of the screen that then fades
 * away, so they all crossfade together instead of popping. If the screen can't be covered, it
 * switches straight away.
 */
export async function switchAppearance(preference: AppearancePreference): Promise<void> {
  const reveal = await cover?.().catch(() => undefined);
  // saveAppearance applies the scheme before it awaits storage, so the reveal is ready before the new colors render.
  const saved = saveAppearance(preference);
  reveal?.();
  await saved;
}

/** Applies the preference now and remembers it for the next launch. */
export async function saveAppearance(preference: AppearancePreference): Promise<void> {
  applyAppearance(preference);
  try {
    await AsyncStorage.setItem(KEY, preference);
  } catch {}
}
