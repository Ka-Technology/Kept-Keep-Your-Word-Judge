// Profile rules for the sign-up and complete-profile forms. Each one mirrors a CHECK constraint on
// the profiles table (supabase/migrations/), so the forms reject exactly what the database rejects.

import { isObjectionable, OBJECTIONABLE_MESSAGE } from './moderation';
import { US_STATES } from './us-states';

/** Usernames: 3–30 lowercase letters, digits, periods, underscores or hyphens (the DB `username` check). */
export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

/** Shown when a username breaks USERNAME_RE. */
export const USERNAME_RULE_MESSAGE = 'Use 3–30 lowercase letters, numbers, periods, underscores or hyphens.';
/** Shown when saving fails because someone else already has the username. */
export const USERNAME_TAKEN_MESSAGE = 'That username is taken.';
/** Shown when no date of birth has been picked. */
export const DOB_MISSING_MESSAGE = 'Enter your date of birth.';
/** Shown to anyone under 18; they can't have a Kept account. */
export const ADULT_MESSAGE = 'Kept is for adults 18 and over.';
/** Shown when no state (from US_STATES) has been picked. */
export const STATE_MISSING_MESSAGE = 'Choose your state.';
/** Shown until Allow or Don't allow is picked for Kept's AI (decision 96: nothing preselected). */
export const AI_CHOICE_MISSING_MESSAGE = 'Choose Allow or Don’t allow.';

/** Shown until the 18+ box is ticked (decision 99: sign-up's About you and complete-profile). */
export const AGREEMENT_MISSING_MESSAGE = 'Tick the box to confirm you’re 18 or older and agree to the Terms and the Privacy Policy.';

/** The longest first or last name (the DB `first_name` and `last_name` checks, migration 0050). */
export const NAME_MAX = 50;

/** "First Last", the name a challenge is signed with (T203), or null until both are on file. */
export function fullName(profile: { first_name: string | null; last_name: string | null }): string | null {
  return profile.first_name && profile.last_name ? `${profile.first_name} ${profile.last_name}` : null;
}
/** Shown until a first name is typed (decision 100: for donation receipts and payments). */
export const FIRST_NAME_MISSING_MESSAGE = 'Enter your first name.';
/** Shown until a last name is typed. */
export const LAST_NAME_MISSING_MESSAGE = 'Enter your last name.';
/** Shown for a name longer than NAME_MAX. */
export const NAME_TOO_LONG_MESSAGE = `Use ${NAME_MAX} characters or fewer.`;

/** What's wrong with one name, ignoring spaces around it (they're trimmed before saving), or undefined. */
export function nameError(name: string, which: 'first' | 'last'): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return which === 'first' ? FIRST_NAME_MISSING_MESSAGE : LAST_NAME_MISSING_MESSAGE;
  if (trimmed.length > NAME_MAX) return NAME_TOO_LONG_MESSAGE;
}

/** What the profile fields hold while being filled in; `null` means not chosen yet. */
export type ProfileInput = {
  firstName: string;
  lastName: string;
  username: string;
  dob: Date | null;
  stateCode: string | null;
  aiAllowed: boolean | null;
  /** The 18+ and Terms tick box (decision 99), never ticked to start. */
  agreed: boolean;
};

/** One message per field that needs fixing; an empty object means the details can be saved. */
export type ProfileErrors = { firstName?: string; lastName?: string; username?: string; dob?: string; state?: string; ai?: string; agreed?: string };

/** Checks the profile fields, including the 18+ rule, the AI answer and the tick box, and returns a message for each problem. */
export function profileErrors({ firstName, lastName, username, dob, stateCode, aiAllowed, agreed }: ProfileInput, today = new Date()): ProfileErrors {
  const errors: ProfileErrors = {};
  const first = nameError(firstName, 'first');
  const last = nameError(lastName, 'last');
  if (first) errors.firstName = first;
  if (last) errors.lastName = last;
  if (!USERNAME_RE.test(username)) errors.username = USERNAME_RULE_MESSAGE;
  else if (isObjectionable(username)) errors.username = OBJECTIONABLE_MESSAGE;
  if (!dob) errors.dob = DOB_MISSING_MESSAGE;
  else if (!isAdult(dob, today)) errors.dob = ADULT_MESSAGE;
  if (!US_STATES.some((s) => s.code === stateCode)) errors.state = STATE_MISSING_MESSAGE;
  if (aiAllowed === null) errors.ai = AI_CHOICE_MISSING_MESSAGE;
  if (!agreed) errors.agreed = AGREEMENT_MISSING_MESSAGE;
  return errors;
}

/**
 * The date as `YYYY-MM-DD` in the user's own calendar, the format the `date_of_birth` column takes.
 * (toISOString() would convert to UTC first, which can move the date by a day.)
 */
export function toDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The reverse of toDateString: a stored `YYYY-MM-DD` as that day in the user's own calendar.
 * (new Date('2000-01-05') would read it as UTC midnight, which is January 4 in the US.)
 */
export function fromDateString(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}

/**
 * How saving the profile went, from the error Supabase returned (null means it worked):
 * - `saved`: done. A duplicate of the user's own row (`profiles_pkey`) also counts, since that
 *   means an earlier save went through but its answer was lost.
 * - `username-taken`: someone else has the username (`profiles_username_key`).
 * - `username-invalid`: the database's username rule refused it (`profiles_username_check`).
 * - `username-objectionable`: the word filter refused it (`text_objectionable`, T53).
 * - `rejected`: the database refused for another reason (it answers with a Postgres error code).
 * - `offline`: no answer at all, so there's no error code.
 */
export type ProfileSaveResult = 'saved' | 'username-taken' | 'username-invalid' | 'username-objectionable' | 'rejected' | 'offline';

/** Sorts the result of a profile insert into a ProfileSaveResult, so the form can say what went wrong. */
export function profileSaveResult(error: { code?: string; message?: string } | null): ProfileSaveResult {
  if (!error) return 'saved';
  const message = error.message ?? '';
  if (error.code === '23505') return message.includes('profiles_username_key') ? 'username-taken' : 'saved';
  if (message.includes('profiles_username_check')) return 'username-invalid';
  if (message.includes('text_objectionable')) return 'username-objectionable';
  return error.code ? 'rejected' : 'offline';
}

/** The sentence for a profile save or Settings edit that didn't go through. */
export function profileSaveMessage(result: Exclude<ProfileSaveResult, 'saved'>): string {
  switch (result) {
    case 'username-taken':
      return USERNAME_TAKEN_MESSAGE;
    case 'username-invalid':
      return USERNAME_RULE_MESSAGE;
    case 'username-objectionable':
      return OBJECTIONABLE_MESSAGE;
    case 'offline':
      return "Couldn't save your profile. Check your connection and try again.";
    case 'rejected':
      return "Kept couldn't save your profile. Please try again.";
  }
}

/**
 * How a Settings edit (username or state) went. Like profileSaveResult, plus one case: an update
 * that row-level security refuses doesn't error, it just updates nothing, so no row back = rejected.
 */
export function profileUpdateResult(error: { code?: string; message?: string } | null, row: unknown): ProfileSaveResult {
  if (error) return profileSaveResult(error);
  return row ? 'saved' : 'rejected';
}

/**
 * Whether someone born on `dob` is at least 18 on `today` (the DB `date_of_birth` check).
 * Only the calendar dates count; the time of day on either one is ignored.
 */
export function isAdult(dob: Date, today = new Date()): boolean {
  const year = today.getFullYear() - 18;
  const month = today.getMonth();
  // Clamp to the month's last day, as Postgres does for `current_date - interval '18 years'`
  // (JS would roll Feb 29 into Mar 1), so the client and the DB check agree.
  const lastDay = new Date(year, month + 1, 0).getDate();
  const cutoff = new Date(year, month, Math.min(today.getDate(), lastDay));
  const birthDate = new Date(dob.getFullYear(), dob.getMonth(), dob.getDate());
  return birthDate <= cutoff;
}
