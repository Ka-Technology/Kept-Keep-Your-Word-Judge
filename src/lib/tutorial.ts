// Whether each user has seen the first-run tutorial (SPEC-app-shell.md), remembered on this device
// in AsyncStorage. A new phone shows it once more, which is harmless and needs no schema change.

import AsyncStorage from '@react-native-async-storage/async-storage';

const key = (userId: string) => `kept.tutorialSeen.${userId}`;

/**
 * True once the user has finished or skipped the tutorial on this device. If storage can't be read
 * it counts as seen, so a broken store never shows the tutorial on every launch (Settings replays it).
 */
export async function hasSeenTutorial(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key(userId))) !== null;
  } catch {
    return true;
  }
}

/** Remembers that the user finished or skipped the tutorial. A failed save just means it shows again. */
export async function markTutorialSeen(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key(userId), 'yes');
  } catch {}
}
