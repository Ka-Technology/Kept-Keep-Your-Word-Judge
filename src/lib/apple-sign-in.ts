// Sign in with Apple (T10; SPEC-identity.md), iOS only. Apple's sheet gives an identity token, which
// Supabase turns into a session (signInWithIdToken, no nonce for native sign-in); a first-time user
// then completes their profile like anyone else. Kept asks Apple only for the email, never the name.
// Right after, Apple's one-time authorization code goes to the apple-token Edge Function, which keeps
// a refresh token so deleting the account can revoke it (App Review requires that).

import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { isAppleCancel } from './auth-state';
import { supabase } from './supabase';

/** Whether this device can show Sign in with Apple: iOS with Apple's sign-in available. */
export function useAppleSignInAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAvailable, () => setAvailable(false));
  }, []);
  return available;
}

/**
 * Signs in with Apple. `cancelled` when the user closed Apple's sheet (no error to show). On success
 * the new session changes the auth state, and the route guards move on by themselves.
 */
export async function signInWithApple(): Promise<'signed-in' | 'cancelled' | { error: { code?: string; message?: string } }> {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL] });
  } catch (e) {
    return isAppleCancel(e) ? 'cancelled' : { error: e as { code?: string; message?: string } };
  }
  if (!credential.identityToken) return { error: { message: 'Apple sent no identity token.' } };
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken });
  if (error) return { error };
  // ponytail: if keeping the token fails (a network blip, or the function's Apple key isn't set yet),
  // deleting this account can't revoke it; the next Apple sign-in stores a fresh one.
  if (credential.authorizationCode) {
    await supabase.functions.invoke('apple-token', { body: { authorizationCode: credential.authorizationCode } }).catch(() => {});
  }
  return 'signed-in';
}

/** Revokes this account's Apple tokens before it's deleted. A failure never blocks the deletion. */
export async function revokeAppleSignIn(): Promise<void> {
  await supabase.functions.invoke('apple-token', { body: { revoke: true } }).catch(() => {});
}
