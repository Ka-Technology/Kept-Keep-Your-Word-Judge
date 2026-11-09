// The sign-in function's rules (T147), kept apart from index.ts so jest can test them.

/** Usernames, as the app (src/lib/profile.ts) and the database check them. */
export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

/** Wrong passwords per account in WINDOW_MINUTES before the function stops trying that username. */
export const FAILURE_LIMIT = 10;
const WINDOW_MINUTES = 60;

/** The username as sign-up saves it (trimmed, lowercase), or null if it could never be one. */
export function usernameFrom(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.trim().toLowerCase();
  return USERNAME_RE.test(name) ? name : null;
}

/** Whether this many wrong passwords in the window means: don't try another. */
export function blocked(failures: number): boolean {
  return failures >= FAILURE_LIMIT;
}

/** The start of the window, as a timestamp for the query. */
export function windowStart(now: number): string {
  return new Date(now - WINDOW_MINUTES * 60_000).toISOString();
}
