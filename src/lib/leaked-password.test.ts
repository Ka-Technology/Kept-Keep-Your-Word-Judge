// Unit tests for leaked-password.ts: reading Have I Been Pwned's range reply (security, 2026-09-27).
import { authErrorMessage, LEAKED_PASSWORD_MESSAGE, PASSWORD_RULE_MESSAGE } from './auth-state';
import { inRange } from './leaked-password';

describe('inRange (whether the breach list has this password’s hash)', () => {
  const body = '0018A45C4D1DEF81644B54AB7F969B88D65:10\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0\r\n011053FD0102E94D6AE2F8B83D76FAF94F6:3';

  it('finds a listed hash suffix, whatever its case', () => {
    expect(inRange(body, '0018a45c4d1def81644b54ab7f969b88d65')).toBe(true);
  });

  it('ignores the padding lines, which have a count of 0, and unlisted suffixes', () => {
    expect(inRange(body, '00D4F6E8FA6EECAD2A3AA415EEC418D38EC')).toBe(false);
    expect(inRange(body, 'FFFFF6E8FA6EECAD2A3AA415EEC418D38EC')).toBe(false);
  });
});

describe('authErrorMessage for a breached password (if Supabase’s own check is ever on)', () => {
  it('says the password was in a breach, not that it breaks the rules', () => {
    expect(authErrorMessage({ code: 'weak_password', reasons: ['pwned'] })).toBe(LEAKED_PASSWORD_MESSAGE);
    expect(authErrorMessage({ code: 'weak_password', reasons: ['length'] })).toBe(PASSWORD_RULE_MESSAGE);
  });
});
