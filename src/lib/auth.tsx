// The identity module's public interface. <AuthProvider> keeps track of the Supabase session and
// the signed-in user's profile; useAuth() hands them to any screen. Per SPEC.md's boundary
// contract, every later module reads the current user only through useAuth().

import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { getAuthState, profileFor, withTimeout, type AuthState, type Profile, type ProfileState, type SessionStatus } from './auth-state';
import { needsTwoStep } from './two-step';
import { clearActive, idleTooLong, lastActive, markActive } from './idle-sign-out';
import { forgetPushToken, stopShieldWarnings } from './notifications';
import { profileUpdateResult, type ProfileSaveResult } from './profile';
import { deviceQuickSignIn } from './quick-sign-in';
import { AUTH_STORAGE_KEY, authStorage, supabase } from './supabase';

/** What useAuth() returns. */
type AuthContextValue = {
  /** Which part of the app the user may see; drives the route guards (see AuthState). */
  state: AuthState;
  /** The Supabase session (the signed-in user and their tokens), or null when signed out. */
  session: Session | null;
  /** The signed-in user's profile, or null if signed out or not completed yet. */
  profile: Profile | null;
  /** Signs out. The route guards then return the user to sign-in. */
  signOut: () => Promise<void>;
  /** Re-checks the session (if it couldn't be refreshed) or re-fetches the profile. Shows loading meanwhile. */
  refreshProfile: () => void;
  /** Reads the profile again with no loading screen: complete-profile's save, which the guards then follow straight to Home. */
  reloadProfile: () => Promise<void>;
  /**
   * Saves an edit to the user's own profile (username, state and photo are the only editable
   * fields) and shows it everywhere at once, without the loading screen refreshProfile() would show.
   */
  updateProfile: (fields: ProfileEdit) => Promise<ProfileSaveResult>;
};

/** The profile fields the user can change (each has an update grant). */
type ProfileEdit = Partial<Pick<Profile, 'first_name' | 'last_name' | 'username' | 'state_code' | 'avatar_path' | 'ai_allowed' | 'health_allowed' | 'showcase_badges'>>;

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Wrap the app in this once (app/_layout.tsx). It follows Supabase's sign-in, sign-out and
 * token-refresh events, fetches the profile whenever the signed-in user changes, and works out
 * `state` with getAuthState().
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const [profileState, setProfileState] = useState<ProfileState | null>(null);
  const [reload, setReload] = useState(0);
  const [recovering, setRecovering] = useState(false);

  // Follow the session: the saved one at startup, then every sign-in, sign-out and token refresh.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      // A reset code signs the user in; hold them on reset-password until the new password is saved.
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      else if (event === 'USER_UPDATED' || !next) setRecovering(false);
      // However the session ended, the next sign-in starts without a last-open time (T87).
      if (event === 'SIGNED_OUT') clearActive();
      if (event === 'INITIAL_SESSION' && !next) {
        // auth-js reports no session when an expired one can't be refreshed offline, but keeps it saved.
        authStorage.getItem(AUTH_STORAGE_KEY).then((saved) => setSessionStatus(saved ? 'offline' : 'loaded'));
      } else {
        setSessionStatus('loaded');
      }
    });
    // A store or network that never answers shows the "Try again" screen, not the splash forever. A late answer still lands.
    const stuck = setTimeout(() => setSessionStatus((status) => (status === 'loading' ? 'offline' : status)), LOAD_TIMEOUT_MS);
    return () => {
      clearTimeout(stuck);
      data.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id;

  // Fetch the profile for each newly signed-in user, and again whenever refreshProfile() asks.
  useEffect(() => {
    if (!userId) return;
    // Ignore the answer if the user changed (or signed out) while it was on its way.
    let current = true;
    fetchProfile(userId).then((result) => {
      if (current) setProfileState(result);
    });
    return () => {
      current = false;
    };
  }, [userId, reload]);

  function refreshProfile() {
    if (sessionStatus === 'offline') {
      setSessionStatus('loading');
      supabase.auth
        .refreshSession()
        .then(({ data, error }) => {
          if (error) {
            // A non-network failure means the saved session is invalid; auth-js has already removed it.
            setSessionStatus(isAuthRetryableFetchError(error) ? 'offline' : 'loaded');
            return;
          }
          setSession(data.session);
          setSessionStatus('loaded');
        })
        .catch(() => setSessionStatus('offline'));
      return;
    }
    setProfileState(null);
    setReload((n) => n + 1);
  }

  async function reloadProfile() {
    if (userId) setProfileState(await fetchProfile(userId));
  }

  /**
   * A sign-out the user chose turns Face ID sign-in off (plan.md decision 85, reversing 65): the
   * sign-in screen starts no scan, and the switch stays off until they turn it on again.
   */
  async function signOut() {
    await deviceQuickSignIn.turnOff().catch(() => {});
    await endSession();
  }

  /** Ends the session on this phone, keeping Face ID sign-in (also the 30-day sign-out's, T87). */
  async function endSession() {
    // While still signed in: this phone stops getting this account's pushes (T34). Offline, the
    // token stays until the next account registers it here, which moves it.
    await forgetPushToken().catch(() => {});
    await stopShieldWarnings();
    const { error } = await supabase.auth.signOut();
    if (error) {
      // auth-js keeps a session it can't load (e.g. offline with an expired token); drop it on this device.
      await authStorage.removeItem(AUTH_STORAGE_KEY);
      await clearActive();
      setSession(null);
      setSessionStatus('loaded');
    }
  }

  // Signed out after 30 days unused (T87, decision 86), keeping Face ID: checked when a signed-in
  // Kept opens and each time it comes back to the screen; leaving the screen records the time.
  const checkIdle = useEffectEvent(async () => {
    if (idleTooLong(await lastActive(), Date.now())) await endSession();
    else await markActive();
  });
  useEffect(() => {
    if (!userId) return;
    checkIdle();
    const sub = AppState.addEventListener('change', (next) => (next === 'active' ? checkIdle() : markActive()));
    return () => sub.remove();
  }, [userId]);

  async function updateProfile(fields: ProfileEdit): Promise<ProfileSaveResult> {
    if (!userId) return 'rejected';
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(fields)
        .eq('id', userId)
        .select(PROFILE_COLUMNS)
        .maybeSingle();
      const result = profileUpdateResult(error, data);
      if (result === 'saved') setProfileState({ userId, status: 'loaded', profile: withDefaults(data) });
      return result;
    } catch {
      return 'offline';
    }
  }

  // Two-step verification on, and this session hasn't given its code yet (T161): read from the session itself, so
  // the app never shows a frame of the main screens first.
  const state = getAuthState({ sessionStatus, session, profileState, recovering, twoStep: needsTwoStep(session) });
  const profile = profileFor(session, profileState)?.profile ?? null;

  return (
    <AuthContext.Provider value={{ state, session, profile, signOut, refreshProfile, reloadProfile, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

/** How long the session and the profile may take before the app says it couldn't load them. */
const LOAD_TIMEOUT_MS = 15_000;

/**
 * Every column of the user's own row, so a build that runs before its migration is pushed still
 * loads the profile: a column the database doesn't have yet simply comes back missing.
 */
const PROFILE_COLUMNS = '*';

/** A loaded row with a missing newer column read as its default (no name yet; ai_allowed: not asked yet; no showcase). */
function withDefaults(row: Profile | null): Profile | null {
  return row && { ...row, first_name: row.first_name ?? null, last_name: row.last_name ?? null, ai_allowed: row.ai_allowed ?? null, health_allowed: row.health_allowed ?? null, showcase_badges: row.showcase_badges ?? [] };
}

/**
 * Reads the user's own profile row (row-level security allows no other). A missing row comes back
 * as `profile: null`, meaning the user still has to complete their profile. A failure of any kind, or no answer,
 * is 'error' (the "Try again" screen): the app's loading screen shows only while this is unsettled.
 */
async function fetchProfile(userId: string): Promise<ProfileState> {
  try {
    const { data, error } = await withTimeout(supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle(), LOAD_TIMEOUT_MS);
    return { userId, status: error ? 'error' : 'loaded', profile: withDefaults(data) };
  } catch {
    return { userId, status: 'error', profile: null };
  }
}

/** The current user and the auth actions. Must be called inside <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
