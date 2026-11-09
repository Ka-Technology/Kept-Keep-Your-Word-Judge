// Unit tests for rules.ts: recovering two-step verification by an email code (T161). Run with the app's jest.
import { canResend, codeFrom, recoveryCheck, recoveryEmail } from './rules';

const now = new Date('2026-10-28T12:00:00Z');
const row = (minutesAgo: number, attempts = 0) => ({
  created_at: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
  expires_at: new Date(now.getTime() + (15 - minutesAgo) * 60_000).toISOString(),
  attempts,
});

describe('recoveryCheck', () => {
  it('takes the right code within 15 minutes and 5 tries', () => {
    expect(recoveryCheck(row(5), now, true)).toBe('ok');
    expect(recoveryCheck(row(5, 4), now, true)).toBe('ok');
  });

  it('refuses a wrong code, an old one, too many tries, or none asked for', () => {
    expect(recoveryCheck(row(5), now, false)).toBe('invalid_code');
    expect(recoveryCheck(row(16), now, true)).toBe('code_expired');
    expect(recoveryCheck(row(5, 5), now, true)).toBe('too_many_tries');
    expect(recoveryCheck(null, now, true)).toBe('invalid_code');
  });
});

describe('canResend', () => {
  it('sends a new code at most once a minute', () => {
    expect(canResend(null, now)).toBe(true);
    expect(canResend(row(0.5), now)).toBe(false);
    expect(canResend(row(2), now)).toBe(true);
  });
});

describe('codeFrom', () => {
  it('makes six digits from a random number, zeros kept', () => {
    expect(codeFrom(123)).toBe('000123');
    expect(codeFrom(4_294_967_295)).toMatch(/^\d{6}$/);
  });
});

describe('recoveryEmail', () => {
  it('is plain text from Kept, with the code and what to do if it wasn’t you', () => {
    const email = recoveryEmail('a@kept.test', '042117');
    expect(email).toEqual({
      from: 'Kept <no-reply@habitkept.com>',
      to: 'a@kept.test',
      subject: 'Your Kept code to turn off two-step verification',
      text: expect.stringContaining('042117'),
    });
    expect(email.text).toMatch(/expires in 15 minutes/);
    expect(email.text).toMatch(/If you didn’t ask/);
  });
});
