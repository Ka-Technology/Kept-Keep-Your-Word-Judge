// Unit tests for sign-in.ts (T147): which usernames the sign-in function looks up, and when it stops
// trying one. Run with the app's jest.
import { USERNAME_RE as APP_USERNAME_RE } from '../../../src/lib/profile';
import { blocked, FAILURE_LIMIT, usernameFrom, USERNAME_RE, windowStart } from './sign-in';

describe('usernameFrom', () => {
  it('reads a username the way sign-up saves it: trimmed and lowercase', () => {
    expect(usernameFrom(' Sam_Reads ')).toBe('sam_reads');
    expect(usernameFrom('sam.reads-2')).toBe('sam.reads-2');
  });

  it('refuses anything that could never be a username, without looking it up', () => {
    expect(usernameFrom('ab')).toBeNull();
    expect(usernameFrom('sam reads')).toBeNull();
    expect(usernameFrom('sam@example.com')).toBeNull();
    expect(usernameFrom(42)).toBeNull();
    expect(usernameFrom(undefined)).toBeNull();
  });

  it('uses the same rule as the app and the database', () => {
    expect(USERNAME_RE.source).toBe(APP_USERNAME_RE.source);
  });
});

describe('blocked (10 wrong passwords an hour per username)', () => {
  it('stops trying at the tenth wrong password in the window', () => {
    expect(FAILURE_LIMIT).toBe(10);
    expect(blocked(9)).toBe(false);
    expect(blocked(10)).toBe(true);
  });

  it('counts the last hour', () => {
    expect(windowStart(Date.UTC(2026, 9, 18, 12, 0, 0))).toBe('2026-10-18T11:00:00.000Z');
  });
});
