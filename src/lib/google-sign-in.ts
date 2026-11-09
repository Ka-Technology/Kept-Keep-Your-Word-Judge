// Sign in with Google (T12; SPEC-identity.md flow 4), iOS for now (Android is T13). Google's native sheet
// gives an ID token, which Supabase turns into a session; a first-time user then completes their profile
// like anyone else. The free library sends no nonce, so Supabase's Google provider skips its nonce check.
// Off until both client IDs are set (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID).
// The library is loaded only then: it throws on import in a build without its native module.

import { Platform } from 'react-native';

import { withTimeout } from './auth-state';
import { supabase } from './supabase';

type GoogleModule = typeof import('@react-native-google-signin/google-signin');

/** Google's sheet can sit open while someone types a password, so it gets longer than the network call after it. */
const SHEET_TIMEOUT_MS = 180_000;
const TOKEN_TIMEOUT_MS = 30_000;

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

/** The library, configured; null when Google sign-in is off (not iOS, or the client IDs aren't set). */
export const google: GoogleModule | null =
  Platform.OS === 'ios' && webClientId && iosClientId
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@react-native-google-signin/google-signin') as GoogleModule)
    : null;

google?.GoogleSignin.configure({ webClientId, iosClientId });

/**
 * Signs in with Google. `cancelled` when the user closed Google's sheet (no error to show). On success
 * the new session changes the auth state, and the route guards move on by themselves.
 */
export async function signInWithGoogle(): Promise<'signed-in' | 'cancelled' | { error: { code?: string; message?: string } }> {
  if (!google) return { error: { message: 'Google sign-in is off.' } };
  let idToken: string | null;
  try {
    // A sheet that closes without answering would otherwise hold "Signing in…" and both sign-in buttons until Kept is restarted.
    const response = await withTimeout(google.GoogleSignin.signIn(), SHEET_TIMEOUT_MS);
    if (google.isCancelledResponse(response)) return 'cancelled';
    idToken = response.data.idToken;
  } catch (e) {
    return { error: e as { code?: string; message?: string } };
  }
  if (!idToken) return { error: { message: 'Google sent no ID token.' } };
  try {
    const { error } = await withTimeout(supabase.auth.signInWithIdToken({ provider: 'google', token: idToken }), TOKEN_TIMEOUT_MS);
    return error ? { error } : 'signed-in';
  } catch (e) {
    return { error: e as { code?: string; message?: string } };
  }
}

/** Disconnects Kept from the Google account before it's deleted. A failure never blocks the deletion. */
export async function revokeGoogleSignIn(): Promise<void> {
  await google?.GoogleSignin.revokeAccess().catch(() => {});
}
