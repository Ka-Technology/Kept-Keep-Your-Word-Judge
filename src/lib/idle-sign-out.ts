// Kept signs out after 30 days unused (T87, plan.md decision 86; SPEC-identity.md flow 11). The
// phone keeps when Kept was last open; AuthProvider checks it whenever a signed-in Kept opens or
// comes back to the screen, and that sign-out keeps Face ID sign-in, so getting back in is one scan.
// The record is cleared at every sign-out, so a fresh sign-in starts with none (auth-js reports a
// restored session as SIGNED_IN too, so "mark at sign-in" can't tell the two apart).
// ponytail: checked in the app only; a copied refresh token still works on the server until
// Supabase Pro's `[auth.sessions] inactivity_timeout = "720h"` (not on the free plan) is turned on.

import AsyncStorage from '@react-native-async-storage/async-storage';

/** How long Kept can go unopened before it signs out: 30 days. */
export const IDLE_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;

const KEY = 'kept.lastActive';

/** Whether Kept was last open more than 30 days before `now`. No record counts as active. */
export function idleTooLong(lastActive: number | null, now: number): boolean {
  return lastActive !== null && now - lastActive > IDLE_LIMIT_MS;
}

/** When Kept was last open on this phone (ms since 1970), or null if there's no usable record. */
export async function lastActive(): Promise<number | null> {
  const value = await AsyncStorage.getItem(KEY).catch(() => null);
  const time = Number(value);
  return value && Number.isFinite(time) ? time : null;
}

/** Records that Kept is open now. */
export async function markActive(now = Date.now()): Promise<void> {
  await AsyncStorage.setItem(KEY, String(now)).catch(() => {});
}

/** Deletes the record, at a sign-out. */
export async function clearActive(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}
