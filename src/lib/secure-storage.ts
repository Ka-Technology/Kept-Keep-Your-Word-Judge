// Where the Supabase session lives on the phone: the iOS Keychain (Android Keystore) through
// expo-secure-store, for this device only, never an unencrypted file (security review, 2026-09-27).
// The Keychain may refuse values past about 2 KB and a session is bigger, so each value is stored in
// chunks, `key.0`, `key.1`, …, with their count at `key.n`. A session an older build left in
// AsyncStorage is moved over the first time it's read, and the file copy is deleted.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/** The largest piece stored in one Keychain item. */
export const CHUNK = 1800;

type Keychain = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};
type Legacy = { getItem(key: string): Promise<string | null>; removeItem(key: string): Promise<void> };

/** A getItem/setItem/removeItem store (what Supabase's `auth.storage` takes) on top of the Keychain, in chunks. */
export function chunkedStorage(keychain: Keychain, legacy?: Legacy) {
  const count = async (key: string) => Number((await keychain.getItemAsync(`${key}.n`)) ?? 0);

  const storage = {
    async getItem(key: string): Promise<string | null> {
      const n = await count(key);
      if (n === 0) {
        const old = await legacy?.getItem(key);
        if (!old) return null;
        await storage.setItem(key, old);
        await legacy!.removeItem(key);
        return old;
      }
      const parts = await Promise.all(Array.from({ length: n }, (_, i) => keychain.getItemAsync(`${key}.${i}`)));
      // A missing piece means a broken session: reading nothing signs the user in afresh.
      return parts.every((p) => p !== null) ? parts.join('') : null;
    },

    async setItem(key: string, value: string): Promise<void> {
      const parts = Array.from({ length: Math.max(1, Math.ceil(value.length / CHUNK)) }, (_, i) => value.slice(i * CHUNK, (i + 1) * CHUNK));
      const before = await count(key);
      for (const [i, part] of parts.entries()) await keychain.setItemAsync(`${key}.${i}`, part);
      await keychain.setItemAsync(`${key}.n`, String(parts.length));
      for (let i = parts.length; i < before; i++) await keychain.deleteItemAsync(`${key}.${i}`);
    },

    async removeItem(key: string): Promise<void> {
      const n = await count(key);
      for (let i = 0; i < n; i++) await keychain.deleteItemAsync(`${key}.${i}`);
      await keychain.deleteItemAsync(`${key}.n`);
    },
  };
  return storage;
}

// ponytail: readable only while the phone is unlocked, which suits a foreground-only app; switch to
// AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY if background work (notifications, T34) needs the session.
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** The session store on iPhone and Android. */
export const secureStorage = chunkedStorage(
  {
    getItemAsync: (key) => SecureStore.getItemAsync(key, OPTIONS),
    setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
    deleteItemAsync: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
  },
  AsyncStorage,
);
