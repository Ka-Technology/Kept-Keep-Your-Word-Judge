// Quick sign-in with Face ID, Touch ID or a fingerprint (T38, SPEC-identity.md). With the sign-in
// screen's switch on, a password sign-in has this phone keep the email and password in the Keychain
// behind biometrics, so reading them back takes a scan. Credentials, not a refresh token: signing out
// revokes refresh tokens, and rotation would soon make a saved copy useless. A second, unlocked item
// holds the choice ('on' or 'off'), so the sign-in screen knows to start the scan by itself. Turning
// it on takes one scan (confirmWithBiometrics); signing out turns it off (decision 85), the 30-day
// sign-out keeps it (T87), and deleting the account forgets it.

import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

type Credentials = { email: string; password: string };
type Keychain = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

/** 'on' or 'off' once the user has chosen on this phone; null means never chosen (the switch starts off). */
export type Choice = 'on' | 'off' | null;

/** What a Face ID sign-in came to. `forgotten`: the saved sign-in stopped working and was deleted. */
export type QuickSignInResult =
  | { kind: 'signed-in' }
  | { kind: 'cancelled' }
  | { kind: 'forgotten'; email: string | null }
  | { kind: 'error'; error: { code?: string; name?: string } };

const CHOICE_KEY = 'kept-quick-sign-in-choice';
const CREDENTIALS_KEY = 'kept-quick-sign-in';

/** The quick sign-in store, on a plain Keychain (the choice) and a biometric-locked one (the credentials). */
export function quickSignIn(plain: Keychain, locked: Keychain) {
  const qs = {
    async choice(): Promise<Choice> {
      const value = await plain.getItemAsync(CHOICE_KEY).catch(() => 'off');
      return value === 'on' || value === 'off' ? value : null;
    },

    /** Saves the sign-in. Deleting first makes it a new item, which the Keychain saves without a scan. */
    async turnOn(credentials: Credentials) {
      await locked.deleteItemAsync(CREDENTIALS_KEY);
      await locked.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials));
      await plain.setItemAsync(CHOICE_KEY, 'on');
    },

    /** The user said no, or turned it off in Settings: delete the sign-in and don't ask again. */
    async turnOff() {
      await locked.deleteItemAsync(CREDENTIALS_KEY);
      await plain.setItemAsync(CHOICE_KEY, 'off');
    },

    /** Deletes everything, back to never chosen (a stale sign-in, a deleted account). */
    async forget() {
      await locked.deleteItemAsync(CREDENTIALS_KEY);
      await plain.deleteItemAsync(CHOICE_KEY);
    },

    /** Reads the sign-in (the phone asks for the scan) and signs in with it. */
    async signIn(signInWithPassword: (c: Credentials) => Promise<{ error: { code?: string; name?: string } | null }>): Promise<QuickSignInResult> {
      let saved: Credentials | null;
      try {
        const json = await locked.getItemAsync(CREDENTIALS_KEY);
        saved = json ? JSON.parse(json) : null;
      } catch {
        // The scan was cancelled or failed: keep the sign-in for next time.
        return { kind: 'cancelled' };
      }
      // Nothing to read: the Keychain drops the item when the phone's Face ID or fingerprints change.
      if (!saved) {
        await qs.forget();
        return { kind: 'forgotten', email: null };
      }
      const { error } = await signInWithPassword(saved);
      if (!error) return { kind: 'signed-in' };
      // The password changed (e.g. a reset) since it was saved.
      if (error.code === 'invalid_credentials') {
        await qs.forget();
        return { kind: 'forgotten', email: saved.email };
      }
      return { kind: 'error', error };
    },
  };
  return qs;
}

/** Quick sign-in saves an email and password, so only accounts with a password (provider 'email') can use it; Apple and Google sign in with their own buttons. */
export const canQuickSignIn = (provider: string | undefined) => provider === 'email';

/** The phone's name for its biometrics, for "Sign in with …"; null if it has none. */
export function biometricName(types: LocalAuthentication.AuthenticationType[], os: string): string | null {
  if (os === 'android') return types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT) ? 'fingerprint' : null;
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'Face ID';
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'Touch ID';
  return null;
}

/**
 * One scan to confirm turning quick sign-in on (owner, 2026-09-30): the switch only goes on if the
 * person holding the phone passes Face ID (or Touch ID, or a fingerprint). No passcode fallback.
 */
export async function confirmWithBiometrics(name: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: `Turn on ${name} sign-in`,
    cancelLabel: 'Cancel',
    disableDeviceFallback: true,
  }).catch(() => ({ success: false }));
  return result.success;
}

const PLAIN_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const LOCKED_OPTIONS: SecureStore.SecureStoreOptions = { ...PLAIN_OPTIONS, requireAuthentication: true, authenticationPrompt: 'Sign in to Kept' };

/** Quick sign-in on this phone. */
export const deviceQuickSignIn = quickSignIn(
  {
    getItemAsync: (key) => SecureStore.getItemAsync(key, PLAIN_OPTIONS),
    setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, PLAIN_OPTIONS),
    deleteItemAsync: (key) => SecureStore.deleteItemAsync(key, PLAIN_OPTIONS),
  },
  {
    getItemAsync: (key) => SecureStore.getItemAsync(key, LOCKED_OPTIONS),
    setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, LOCKED_OPTIONS),
    deleteItemAsync: (key) => SecureStore.deleteItemAsync(key, LOCKED_OPTIONS),
  },
);

/**
 * This phone's biometric name (null if it has none set up, so nothing is offered) and the user's
 * choice. `refresh` re-reads the choice after it changes.
 */
export function useQuickSignIn() {
  const [name, setName] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>('off');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    (async () => {
      const usable = SecureStore.canUseBiometricAuthentication();
      const types = usable ? await LocalAuthentication.supportedAuthenticationTypesAsync().catch(() => []) : [];
      const next = await deviceQuickSignIn.choice();
      if (!current) return;
      setName(biometricName(types, Platform.OS));
      setChoice(next);
    })();
    return () => {
      current = false;
    };
  }, [reload]);

  return { name, choice, refresh: () => setReload((n) => n + 1) };
}
