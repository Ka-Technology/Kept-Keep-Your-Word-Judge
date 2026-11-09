// Pure auth logic, with no React or Supabase imports, so every rule here is unit-tested
// (auth-state.test.ts). It decides which screens a user may see, and holds the input checks
// and error messages that the sign-in, sign-up and verify screens share.

import { USERNAME_RE } from './profile';

/** A row of the `profiles` table: what Kept knows about a user beyond their email. */
export type Profile = {
  id: string;
  /** The real name, seen only by the user (decision 100, migration 0050); null on accounts from before until added. */
  first_name: string | null;
  last_name: string | null;
  username: string;
  date_of_birth: string;
  state_code: string;
  /** Where the profile photo is in the `avatars` bucket, or null for none (T47). */
  avatar_path: string | null;
  /** Whether Kept's AI may check their days (T54): null until asked before the first check-in. */
  ai_allowed: boolean | null;
  /** The health-habit consent (T179, migration 0075): null until asked. */
  health_allowed: boolean | null;
  /** Up to three badge ids to lead the profile, in the order chosen (migration 0042). */
  showcase_badges: string[];
};

/**
 * The result of fetching a user's profile. `userId` records whose profile it is, so a result
 * that arrives late for a previous user is never mistaken for the current one's.
 * `profile: null` with status 'loaded' means the user hasn't completed their profile yet.
 */
export type ProfileState = {
  userId: string;
  status: 'loaded' | 'error';
  profile: Profile | null;
};

/**
 * Which part of the app a user may see (the `Stack.Protected` guards in app/_layout.tsx):
 * - `loading`: still finding out; the splash screen stays up.
 * - `signed-out`: the sign-in, sign-up and verify screens.
 * - `needs-profile`: signed in without a profile; only complete-profile.
 * - `ready`: signed in with a profile; the main app.
 * - `recovering`: signed in by a password-reset code; only reset-password, until the new password is saved.
 * - `two-step`: signed in with a password, but two-step verification is on (T161); only its code screen.
 * - `error`: the account couldn't be loaded; a "Try again" screen.
 */
export type AuthState = 'loading' | 'signed-out' | 'needs-profile' | 'ready' | 'recovering' | 'two-step' | 'error';

/** 'offline': a saved session exists but could not be refreshed, so the user is not really signed out. */
export type SessionStatus = 'loading' | 'loaded' | 'offline';

/** The only part of a Supabase session these functions need, so tests can pass plain objects. */
type SessionLike = { user: { id: string } } | null;

/** The profile result for the signed-in user, or null while none has arrived for them (e.g. a previous user's is on hand). */
export function profileFor(session: SessionLike, profileState: ProfileState | null): ProfileState | null {
  return session && profileState?.userId === session.user.id ? profileState : null;
}

/**
 * Works out the user's AuthState from the session and their profile fetch. This is the only
 * place routing is decided: screens never redirect on their own, the guards follow this value.
 */
export function getAuthState({
  sessionStatus,
  session,
  profileState,
  recovering = false,
  twoStep = false,
}: {
  sessionStatus: SessionStatus;
  session: SessionLike;
  profileState: ProfileState | null;
  /** True between a password-reset code signing the user in and their new password being saved. */
  recovering?: boolean;
  /** True while two-step verification is on and this session hasn't given its code (two-step.ts needsTwoStep()). */
  twoStep?: boolean;
}): AuthState {
  if (sessionStatus === 'loading') return 'loading';
  if (sessionStatus === 'offline') return 'error';
  if (!session) return 'signed-out';
  if (recovering) return 'recovering';
  if (twoStep) return 'two-step';
  const current = profileFor(session, profileState);
  if (!current) return 'loading';
  if (current.status === 'error') return 'error';
  return current.profile ? 'ready' : 'needs-profile';
}

/**
 * The message for a failed password change. It checks the current password by signing in with it,
 * so wrong credentials there mean the current password was wrong.
 */
export function changePasswordErrorMessage(error: { code?: string; name?: string; message?: string }): string {
  return error.code === 'invalid_credentials' ? "That isn't your current password." : authErrorMessage(error);
}

/** Change email (T207): the new address taken, or a two-step account without its second step; the rest as everywhere. */
export function emailChangeErrorMessage(error: { code?: string; name?: string; message?: string }): string {
  if (error.code === 'email_exists') return 'That email already has a Kept account.';
  if (error.code === 'insufficient_aal') return 'Finish your two-step sign-in first, then try again.';
  return authErrorMessage(error);
}

/** How the user signs in, from Supabase's `app_metadata.provider`, for the Settings screen. */
export function signInMethodLabel(provider: string | undefined): string {
  if (!provider) return 'Unknown';
  return { email: 'Email and password', google: 'Google', apple: 'Apple' }[provider] ?? provider;
}

/** Shown on sign-up when the email already has an account (see isExistingAccount()). */
export const EXISTING_ACCOUNT_MESSAGE = 'That email already has a Kept account. Sign in instead.';

/**
 * Whether a sign-up hit an email that already has a confirmed account. Supabase doesn't return an
 * error then: it sends no email and answers with a stand-in user that has no identities. (An email
 * that signed up but never entered its code gets a fresh code and counts as new.)
 */
export function isExistingAccount(user: { identities?: unknown[] } | null): boolean {
  return user?.identities?.length === 0;
}

/** Shown when Supabase couldn't send the code email (its mail provider refused or failed): no account was made. */
export const SEND_CODE_FAILED_MESSAGE = 'Couldn’t send your code. Wait a minute and try again.';

/**
 * Sign-up's failures, which share authErrorMessage() but for two: Supabase answers `unexpected_failure` when its
 * mail provider refuses the code email, and a taken address can come back as an error instead of a stand-in user.
 */
export function signUpErrorMessage(error: { code?: string; name?: string; message?: string; reasons?: string[] }): string {
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return EXISTING_ACCOUNT_MESSAGE;
  if (error.code === 'unexpected_failure') return SEND_CODE_FAILED_MESSAGE;
  return authErrorMessage(error);
}

/** Rejects with `{ code: 'timeout' }` when `work` hasn't settled in `ms`, so no spinner waits forever on a call that never answers. */
export function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject({ code: 'timeout' }), ms);
    Promise.resolve(work)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

/** Shown under an email field when isValidEmail() fails. */
export const EMAIL_FORMAT_MESSAGE = 'Enter a valid email address, like name@example.com.';

/**
 * A light format check (something@something.something) that catches typos before any network
 * call. Supabase does the authoritative check. Surrounding spaces are ignored.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@.][^\s@]*\.[^\s@]+$/.test(email.trim());
}

/** Shown under the sign-in box when it holds neither an email nor a possible username. */
export const SIGN_IN_NAME_MESSAGE = 'Enter your email or username.';

/**
 * What the sign-in box holds (T147, decision 102): anything with an @ is an email; the rest is a
 * username, lowercased as sign-up saves it. Otherwise the message to show under the box.
 */
export function signInName(input: string): { email: string } | { username: string } | { error: string } {
  const text = input.trim();
  if (text.includes('@')) return isValidEmail(text) ? { email: text } : { error: EMAIL_FORMAT_MESSAGE };
  const username = text.toLowerCase();
  return USERNAME_RE.test(username) ? { username } : { error: SIGN_IN_NAME_MESSAGE };
}

// Must match minimum_password_length, password_requirements and otp_length in supabase/config.toml (tested).
/** Shortest password Kept accepts, on the sign-up form and in Supabase. */
export const MIN_PASSWORD_LENGTH = 8;
/** Shown when a password breaks the rules, whether the form or Supabase catches it. */
export const PASSWORD_RULE_MESSAGE =
  'Use at least 8 characters, with a lowercase letter, an uppercase letter, a number and a special character.';
/** Shown when a password is on Have I Been Pwned's breach list (leaked-password.ts, or Supabase's own check). */
export const LEAKED_PASSWORD_MESSAGE = 'This password has shown up in a data breach, so it’s easy to guess. Choose a different one.';
/** Shown after a reset request, whether or not the email has an account, so the answer reveals nothing. */
export const RECOVERY_SENT_MESSAGE = 'If that email has an account, we sent a code.';

/** Shown when the confirm-password box doesn't match the password. */
export const PASSWORD_MISMATCH_MESSAGE = "The passwords don't match.";

/**
 * What Supabase counts as a special character under `lower_upper_letters_digits_symbols`: the 32
 * ASCII punctuation marks. Spaces and accented letters are allowed in a password but don't count.
 */
export const SPECIAL_CHARACTERS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

const hasAny = (password: string, chars: string) => [...password].some((c) => chars.includes(c));

/** Each password rule and whether `password` meets it, in the order the sign-up checklist shows them. */
export function passwordChecks(password: string): { rule: string; met: boolean }[] {
  return [
    { rule: `At least ${MIN_PASSWORD_LENGTH} characters`, met: password.length >= MIN_PASSWORD_LENGTH },
    { rule: 'A lowercase letter', met: hasAny(password, 'abcdefghijklmnopqrstuvwxyz') },
    { rule: 'An uppercase letter', met: hasAny(password, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') },
    { rule: 'A number', met: hasAny(password, '0123456789') },
    { rule: 'A special character, like ! or #', met: hasAny(password, SPECIAL_CHARACTERS) },
  ];
}

/** Whether `password` meets every rule, i.e. Supabase will accept it. */
export function isStrongPassword(password: string): boolean {
  return passwordChecks(password).every((check) => check.met);
}

/** Number of digits in the codes Kept emails for sign-up and password reset. */
export const OTP_LENGTH = 6;
/** How long an emailed code works: `otp_expiry` (3600 seconds) in supabase/config.toml (tested). */
export const CODE_LIFETIME = 'Codes last 15 minutes';
/** Shown when a code is wrong or expired; Supabase reports both the same way. */
export const CODE_MESSAGE = "That code didn't work. Check it or send a new one.";

/** Whether `code` is exactly OTP_LENGTH digits (surrounding spaces allowed), so only plausible codes are sent. */
export function isValidCode(code: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code.trim());
}

/** The OTP_LENGTH-digit code in pasted text ("123 456", or a sentence holding one), or '' when there isn't one. */
export function codeFromText(text: string): string {
  // Six digits, or two groups of three as an authenticator app shows them; never part of a longer number.
  const match = /(?<!\d)(\d{3})[\s-]?(\d{3})(?!\d)/.exec(text);
  return match ? match[1] + match[2] : '';
}

/**
 * Turns a Supabase auth error into a plain sentence for the user. Raw error codes and messages
 * are never shown (SPEC.md code style); anything unrecognized gets a generic sentence.
 */
export function authErrorMessage(error: { code?: string; name?: string; message?: string; reasons?: string[] }): string {
  // No response at all, or the server timed out (HTTP 502/503/504).
  if (error.name === 'AuthRetryableFetchError' || error.code === 'timeout') {
    return "Couldn't reach Kept. Check your connection and try again.";
  }
  switch (error.code) {
    case 'invalid_credentials':
      return 'Email or password is incorrect.';
    // The sign-in function's answers for a username (T147).
    case 'wrong_username_or_password':
      return 'Username or password is incorrect.';
    case 'too_many_attempts':
      return 'Too many wrong passwords for this username. Sign in with your email, or try again in an hour.';
    case 'try_later':
      return 'Couldn’t sign in just now. Wait a minute and try again.';
    case 'email_not_confirmed':
      return 'Confirm your email first. Check your inbox for the code.';
    case 'otp_expired':
      return CODE_MESSAGE;
    case 'over_email_send_rate_limit':
      return 'Too many emails sent. Wait a minute and try again.';
    case 'over_request_rate_limit':
      return 'Too many tries. Wait a minute and try again.';
    case 'weak_password':
      return error.reasons?.includes('pwned') ? LEAKED_PASSWORD_MESSAGE : PASSWORD_RULE_MESSAGE;
    case 'same_password':
      return 'That is your current password. Choose a new one.';
    case 'email_address_invalid':
      return EMAIL_FORMAT_MESSAGE;
    case 'email_address_not_authorized':
      // Only without custom SMTP: Supabase's built-in sender reaches just the project's org members.
      return "Kept can't send email to that address yet. Try another email.";
    default:
      return 'Something went wrong. Please try again.';
  }
}

/** Whether Sign in with Apple failed only because the user closed Apple's sheet (T10): no error to show. */
export function isAppleCancel(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'ERR_REQUEST_CANCELED';
}
