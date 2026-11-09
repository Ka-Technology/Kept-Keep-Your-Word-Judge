// The one Supabase client the whole app uses. The URL and publishable (anon) key come from
// env/<test|prod>.env, which `npm start` (scripts/deploy.mjs <test|prod> start) hands to the dev server and EAS builds read from their own
// environment; they're safe to ship in the app because row-level security protects the data. The
// session (the tokens) is kept in the Keychain on the phone (secure-storage.ts), never in a file.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { secureStorage } from './secure-storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Start the dev server with `npm start` (it reads env/test.env), not `expo start`.');
}

/** Where the session is persisted; named so the app can tell "no session" from "session it couldn't refresh". */
export const AUTH_STORAGE_KEY = 'kept-auth';

/**
 * The session's store: the Keychain on iPhone and Android. The web build (not shipped) keeps
 * Supabase's default, the browser's storage.
 */
export const authStorage = Platform.OS === 'web' ? AsyncStorage : secureStorage;

/**
 * The app-wide Supabase client. The session is saved on the device, so users stay signed in
 * across restarts, and its token refreshes automatically while the app is open.
 */
export const supabase = createClient(url, key, {
  auth: {
    storage: authStorage,
    storageKey: AUTH_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is in the foreground (web handles this itself).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
