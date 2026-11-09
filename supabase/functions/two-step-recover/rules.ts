// The rules of `two-step-recover` (T161) that don't touch the network: whether a recovery code stands, when a new
// one may be sent, the code itself, and its email. No imports, so Deno and jest both load it (rules.test.ts).

/** A code lasts 15 minutes and takes 5 tries; a new one can be asked for once a minute. */
export const CODE_MINUTES = 15;
export const MAX_TRIES = 5;
const RESEND_SECONDS = 60;

/** Whether a code may be used: the right one, still fresh, within its tries. */
export function recoveryCheck(
  row: { expires_at: string; attempts: number } | null,
  now: Date,
  matches: boolean,
): 'ok' | 'invalid_code' | 'code_expired' | 'too_many_tries' {
  if (!row) return 'invalid_code';
  if (row.attempts >= MAX_TRIES) return 'too_many_tries';
  if (Date.parse(row.expires_at) <= now.getTime()) return 'code_expired';
  return matches ? 'ok' : 'invalid_code';
}

/** Whether a new code may be emailed: none yet, or the last one is at least a minute old. */
export function canResend(row: { created_at: string } | null, now: Date): boolean {
  return !row || now.getTime() - Date.parse(row.created_at) >= RESEND_SECONDS * 1000;
}

/** Six digits from a random 32-bit number, leading zeros kept. */
export function codeFrom(random: number): string {
  return String(random % 1_000_000).padStart(6, '0');
}

/** The email, plain text only, through Resend's API. */
export function recoveryEmail(to: string, code: string): { from: string; to: string; subject: string; text: string } {
  return {
    from: 'Kept <no-reply@habitkept.com>',
    to,
    subject: 'Your Kept code to turn off two-step verification',
    text: [
      `Your code is ${code}. Enter it in Kept to turn off two-step verification, so you can sign in without your authenticator app.`,
      '',
      `It expires in ${CODE_MINUTES} minutes.`,
      '',
      'If you didn’t ask for it, someone may have your password: ignore this email, keep your authenticator app, and change your password in Kept.',
    ].join('\n'),
  };
}
