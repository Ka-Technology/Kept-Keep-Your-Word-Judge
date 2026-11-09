// Which kept days each challenge's stamp strip last showed on this device (T98), so a day approved
// since then stamps itself in the next time Home shows it. AsyncStorage, like the tutorial flag: a
// new phone starts with no memory, and nothing replays the first time.

import AsyncStorage from '@react-native-async-storage/async-storage';

const key = (challengeId: string) => `kept.stampsSeen.${challengeId}`;

/** The kept days not shown before. With no memory yet (a first look, or a store that failed), none. */
export function freshKept(keptNow: number[], seen: number[] | null): number[] {
  return seen ? keptNow.filter((day) => !seen.includes(day)) : [];
}

/** Reads what the strip showed last time, remembers what it shows now, and returns the days to stamp in. Never throws. */
export async function takeFreshKept(challengeId: string, keptNow: number[]): Promise<number[]> {
  let seen: number[] | null = null;
  try {
    const stored = await AsyncStorage.getItem(key(challengeId));
    seen = stored ? (JSON.parse(stored) as number[]) : null;
  } catch {}
  try {
    await AsyncStorage.setItem(key(challengeId), JSON.stringify(keptNow));
  } catch {}
  return freshKept(keptNow, seen);
}
