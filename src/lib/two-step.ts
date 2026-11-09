// Two-step verification (T161; SPEC.md's real-money list): an authenticator app's code after the password, for
// anyone who turns it on in Settings → Privacy & security. Supabase's TOTP factors do the work; this decides when
// a signed-in session still needs its code (getAuthState()'s 'two-step'), with no React or Supabase imports, so
// it's unit-tested (two-step.test.ts). Losing the app is recovered by an email code (`two-step-recover`).

/** The session's assurance level from its access token: 'aal2' once its code was given, or null if unreadable. */
export function jwtAal(accessToken: string): string | null {
  try {
    const part = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    // A byte string is enough: the claim read here is plain ASCII.
    const claims = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return typeof claims.aal === 'string' ? claims.aal : null;
  } catch {
    return null;
  }
}

/** Whether the app waits for the authenticator code: a verified one is on, and this session hasn't used it. */
export function needsTwoStep(session: { access_token: string; user: { factors?: { factor_type: string; status: string }[] } } | null): boolean {
  if (!session?.user.factors?.some((f) => f.factor_type === 'totp' && f.status === 'verified')) return false;
  return jwtAal(session.access_token) !== 'aal2';
}

/** Why the recovery email didn't go: asked again within the minute (the code already sent still works), or anything else. */
export function recoverySendMessage(code: string | undefined): string {
  return code === 'wait_a_minute' ? 'We just emailed you a code. It may take a minute to arrive.' : 'Couldn’t send the email. Try again in a little while.';
}

/** A plain sentence for a refused code or a failed step (never the raw auth error). */
export function twoStepErrorMessage(error: { code?: string; message?: string }): string {
  if (error.code === 'mfa_verification_failed' || error.code === 'invalid_code') return 'That code didn’t work. Check your authenticator app and try again.';
  if (error.code === 'code_expired') return 'That code expired. Ask for a new one.';
  if (error.code === 'too_many_tries') return 'Too many wrong codes. Ask for a new one.';
  if (!error.code) return 'Couldn’t reach Kept. Check your connection and try again.';
  return 'That didn’t work. Please try again.';
}
