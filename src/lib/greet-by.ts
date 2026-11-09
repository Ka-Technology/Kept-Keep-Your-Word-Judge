// How Home greets the user (T146, decision 101): by first name (the default, once the account has
// one) or by username, chosen in Settings → App and remembered on this device, like the appearance.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type GreetBy = 'name' | 'username';

const KEY = 'kept.greetBy';

/** The saved choice, or the name if there's none (or storage can't be read). */
export async function loadGreetBy(): Promise<GreetBy> {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'username' ? 'username' : 'name';
  } catch {
    return 'name';
  }
}

/** Remembers the choice for Home. */
export async function saveGreetBy(choice: GreetBy): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, choice);
  } catch {}
}
