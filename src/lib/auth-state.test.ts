/// <reference types="node" />
// Unit tests for auth-state.ts: routing decisions, input checks, error messages, and that the
// password and code rules match supabase/config.toml.
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  authErrorMessage,
  changePasswordErrorMessage,
  SEND_CODE_FAILED_MESSAGE,
  signUpErrorMessage,
  withTimeout,
  codeFromText,
  CODE_LIFETIME,
  CODE_MESSAGE,
  EMAIL_FORMAT_MESSAGE,
  emailChangeErrorMessage,
  EXISTING_ACCOUNT_MESSAGE,
  getAuthState,
  isExistingAccount,
  isValidCode,
  isValidEmail,
  isStrongPassword,
  MIN_PASSWORD_LENGTH,
  OTP_LENGTH,
  PASSWORD_RULE_MESSAGE,
  passwordChecks,
  profileFor,
  RECOVERY_SENT_MESSAGE,
  signInMethodLabel,
  signInName,
  SIGN_IN_NAME_MESSAGE,
  SPECIAL_CHARACTERS,
  type ProfileState, isAppleCancel } from './auth-state';

describe('client auth rules match supabase/config.toml', () => {
  const config = readFileSync(join(__dirname, '../../supabase/config.toml'), 'utf8');
  const setting = (name: string) => Number(config.match(new RegExp(`^${name}\\s*=\\s*(\\d+)`, 'm'))?.[1]);

  it('uses the same minimum password length', () => {
    expect(setting('minimum_password_length')).toBe(MIN_PASSWORD_LENGTH);
  });

  it('uses the same email code length', () => {
    expect(setting('otp_length')).toBe(OTP_LENGTH);
  });

  it('says how long a code lasts from otp_expiry (15 minutes since T161), in the app and both emails', () => {
    expect(setting('otp_expiry')).toBe(900);
    expect(CODE_LIFETIME).toBe('Codes last 15 minutes');
    for (const template of ['confirmation', 'recovery']) {
      expect(readFileSync(join(__dirname, `../../supabase/templates/${template}.html`), 'utf8')).toContain('The code expires in 15 minutes.');
    }
  });

  it('asks for a recent sign-in to change a password (T161)', () => {
    expect(config).toMatch(/^secure_password_change = true$/m);
  });

  it('trusts Apple tokens for the app’s own bundle ID (T36)', () => {
    const appJson = JSON.parse(readFileSync(join(__dirname, '../../app.json'), 'utf8'));
    const appleClientId = config.split('[auth.external.apple]')[1]?.match(/^client_id\s*=\s*"(.+)"/m)?.[1];
    expect(appJson.expo.ios.bundleIdentifier).toBe('com.habitkept.ios');
    expect(appleClientId).toBe(appJson.expo.ios.bundleIdentifier);
  });

  it('sends codes from Kept’s own domain, not Gmail (T36)', () => {
    const smtp = config.split('[auth.email.smtp]')[1];
    expect(smtp).toMatch(/^host\s*=\s*"smtp\.resend\.com"/m);
    expect(smtp).toMatch(/^admin_email\s*=\s*"no-reply@habitkept\.com"/m);
  });

  it('asks for passwords of at least 8 characters (SPEC-identity.md)', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it('requires the same character kinds (lowercase, uppercase, digit, symbol)', () => {
    expect(config).toMatch(/^password_requirements\s*=\s*"lower_upper_letters_digits_symbols"/m);
  });

  it.each(['confirmation', 'recovery'])('puts the code itself in the %s email, not only a link', (template) => {
    const path = config.split(`[auth.email.template.${template}]`)[1]?.match(/content_path = "\.\/(.+)"/)?.[1];
    expect(path).toBeDefined();
    expect(readFileSync(join(__dirname, '../..', path!), 'utf8')).toContain('{{ .Token }}');
  });
});

describe('isExistingAccount', () => {
  it('spots the stand-in user Supabase returns when the email already has an account', () => {
    expect(isExistingAccount({ identities: [] })).toBe(true);
  });

  it('treats a brand-new (or never-confirmed) sign-up as new', () => {
    expect(isExistingAccount({ identities: [{ id: 'identity-1' }] })).toBe(false);
    expect(isExistingAccount({})).toBe(false);
    expect(isExistingAccount(null)).toBe(false);
  });

  it('points the user to sign-in', () => {
    expect(EXISTING_ACCOUNT_MESSAGE).toBe('That email already has a Kept account. Sign in instead.');
  });
});

describe('password rules', () => {
  it('accepts a password with every kind of character', () => {
    expect(isStrongPassword('Kept2026!')).toBe(true);
  });

  it.each([
    ['too short', 'Ke2026!'],
    ['no lowercase letter', 'KEPT2026!'],
    ['no uppercase letter', 'kept2026!'],
    ['no number', 'KeptKept!'],
    ['no special character', 'Kept20266'],
    ['a space is not a special character', 'Kept 2026'],
    ['an accented letter is not a special character', 'Kept2026é'],
  ])('rejects a password with %s (%p)', (_label, password) => {
    expect(isStrongPassword(password)).toBe(false);
  });

  it('lists each rule in order, met or not, for the checklist under the field', () => {
    expect(passwordChecks('kept2')).toEqual([
      { rule: 'At least 8 characters', met: false },
      { rule: 'A lowercase letter', met: true },
      { rule: 'An uppercase letter', met: false },
      { rule: 'A number', met: true },
      { rule: 'A special character, like ! or #', met: false },
    ]);
  });

  it("counts exactly Supabase's special characters: all 32 ASCII punctuation marks", () => {
    const asciiPunctuation = [...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'];
    expect([...SPECIAL_CHARACTERS].sort()).toEqual(asciiPunctuation.sort());
  });
});

describe('isValidCode', () => {
  it.each(['123456', '000000', ' 123456 '])('accepts %p', (code) => {
    expect(isValidCode(code)).toBe(true);
  });

  it.each([
    ['too short', '12345'],
    ['too long', '1234567'],
    ['letters', '12a456'],
    ['space inside', '123 456'],
    ['empty', ''],
  ])('rejects %s (%p)', (_label, code) => {
    expect(isValidCode(code)).toBe(false);
  });
});

describe('codeFromText (a code pasted from the authenticator app or a message)', () => {
  it('takes the digits, however the app spaced them', () => {
    expect(codeFromText('123456')).toBe('123456');
    expect(codeFromText('123 456')).toBe('123456');
    expect(codeFromText(' 123-456' + String.fromCharCode(10))).toBe('123456');
  });

  it('finds the code in a sentence', () => {
    expect(codeFromText('Your Kept code is 482913. It expires soon.')).toBe('482913');
  });

  it('is empty when there is no six-digit code, never half of one', () => {
    expect(codeFromText('12345')).toBe('');
    expect(codeFromText('hello')).toBe('');
    expect(codeFromText('')).toBe('');
  });
});

describe('signInName (the sign-in box takes an email or a username, T147)', () => {
  it('reads anything with an @ as an email, trimmed', () => {
    expect(signInName('  sam@example.com ')).toEqual({ email: 'sam@example.com' });
    expect(signInName('sam@example')).toEqual({ error: EMAIL_FORMAT_MESSAGE });
  });

  it('reads the rest as a username, lowercased the way sign-up saves it', () => {
    expect(signInName(' Sam_Reads ')).toEqual({ username: 'sam_reads' });
    expect(signInName('sam reads')).toEqual({ error: SIGN_IN_NAME_MESSAGE });
    expect(signInName('')).toEqual({ error: SIGN_IN_NAME_MESSAGE });
    expect(SIGN_IN_NAME_MESSAGE).toBe('Enter your email or username.');
  });
});

describe('isValidEmail', () => {
  it.each(['a@b.co', 'first.last+kept@mail.example.com', '  padded@example.com  '])('accepts %p', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['no @', 'plainaddress'],
    ['no domain dot', 'name@example'],
    ['nothing before @', '@example.com'],
    ['space inside', 'na me@example.com'],
    ['two @', 'a@b@example.com'],
    ['domain starts with a dot', 'name@.com'],
  ])('rejects %s (%p)', (_label, email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});

const session = { user: { id: 'user-a' } };
const profileA = { id: 'user-a', first_name: 'Alice', last_name: 'Test', username: 'alice', date_of_birth: '1990-01-01', state_code: 'NY', avatar_path: null, ai_allowed: null, health_allowed: null, showcase_badges: [] };

describe('getAuthState', () => {
  it('is loading until the stored session has been read', () => {
    expect(getAuthState({ sessionStatus: 'loading', session: null, profileState: null })).toBe('loading');
  });

  it('is error, not signed-out, when a saved session could not be refreshed (offline)', () => {
    expect(getAuthState({ sessionStatus: 'offline', session: null, profileState: null })).toBe('error');
  });

  it('is signed-out when there is no session', () => {
    expect(getAuthState({ sessionStatus: 'loaded', session: null, profileState: null })).toBe('signed-out');
  });

  it("is loading until the signed-in user's profile has been fetched", () => {
    expect(getAuthState({ sessionStatus: 'loaded', session, profileState: null })).toBe('loading');
  });

  it('is needs-profile when the signed-in user has no profile yet', () => {
    const profileState: ProfileState = { userId: 'user-a', status: 'loaded', profile: null };
    expect(getAuthState({ sessionStatus: 'loaded', session, profileState })).toBe('needs-profile');
  });

  it('is ready when the signed-in user has a profile', () => {
    const profileState: ProfileState = { userId: 'user-a', status: 'loaded', profile: profileA };
    expect(getAuthState({ sessionStatus: 'loaded', session, profileState })).toBe('ready');
  });

  it('is error when the profile could not be fetched', () => {
    const profileState: ProfileState = { userId: 'user-a', status: 'error', profile: null };
    expect(getAuthState({ sessionStatus: 'loaded', session, profileState })).toBe('error');
  });

  it('is loading, not ready, when the profile on hand belongs to the previous user', () => {
    const profileState: ProfileState = { userId: 'user-b', status: 'loaded', profile: { ...profileA, id: 'user-b' } };
    expect(getAuthState({ sessionStatus: 'loaded', session, profileState })).toBe('loading');
  });

  it('is loading, not needs-profile, when the missing profile belongs to the previous user', () => {
    const profileState: ProfileState = { userId: 'user-b', status: 'loaded', profile: null };
    expect(getAuthState({ sessionStatus: 'loaded', session, profileState })).toBe('loading');
  });

  it('is recovering, not ready, after a password-reset code signs the user in', () => {
    const profileState: ProfileState = { userId: 'user-a', status: 'loaded', profile: profileA };
    expect(getAuthState({ sessionStatus: 'loaded', session, profileState, recovering: true })).toBe('recovering');
  });

  it('is recovering without waiting for the profile, which a new password does not need', () => {
    expect(getAuthState({ sessionStatus: 'loaded', session, profileState: null, recovering: true })).toBe('recovering');
  });

  it('is signed-out, not recovering, once the session is gone', () => {
    expect(getAuthState({ sessionStatus: 'loaded', session: null, profileState: null, recovering: true })).toBe(
      'signed-out',
    );
  });
});

describe('signInMethodLabel', () => {
  it.each([
    ['email', 'Email and password'],
    ['google', 'Google'],
    ['apple', 'Apple'],
  ])('names the %s provider', (provider, label) => {
    expect(signInMethodLabel(provider)).toBe(label);
  });

  it('shows an unexpected provider as it is rather than hiding it', () => {
    expect(signInMethodLabel('github')).toBe('github');
    expect(signInMethodLabel(undefined)).toBe('Unknown');
  });
});

describe('changePasswordErrorMessage', () => {
  it('says the current password is wrong, rather than the sign-in wording', () => {
    expect(changePasswordErrorMessage({ code: 'invalid_credentials', name: 'AuthApiError' })).toBe(
      "That isn't your current password.",
    );
  });

  it('explains everything else the same way as the other auth screens', () => {
    expect(changePasswordErrorMessage({ code: 'same_password', name: 'AuthApiError' })).toBe(
      authErrorMessage({ code: 'same_password' }),
    );
    expect(changePasswordErrorMessage({ name: 'AuthRetryableFetchError' })).toBe(
      authErrorMessage({ name: 'AuthRetryableFetchError' }),
    );
  });
});

describe('emailChangeErrorMessage (Change email, T207)', () => {
  it('says the new address already has an account', () => {
    expect(emailChangeErrorMessage({ code: 'email_exists', name: 'AuthApiError' })).toBe('That email already has a Kept account.');
  });

  it('asks a two-step account to finish two-step sign-in first', () => {
    expect(emailChangeErrorMessage({ code: 'insufficient_aal', name: 'AuthApiError' })).toBe('Finish your two-step sign-in first, then try again.');
  });

  it('explains wrong codes, rate limits and the rest the same way as the other auth screens', () => {
    expect(emailChangeErrorMessage({ code: 'otp_expired' })).toBe(CODE_MESSAGE);
    expect(emailChangeErrorMessage({ code: 'over_email_send_rate_limit' })).toBe(authErrorMessage({ code: 'over_email_send_rate_limit' }));
    expect(emailChangeErrorMessage({ name: 'AuthRetryableFetchError' })).toBe(authErrorMessage({ name: 'AuthRetryableFetchError' }));
  });
});

describe('the email change template (T207)', () => {
  it('is set in config.toml and shows the code', () => {
    const config = readFileSync(join(__dirname, '../../supabase/config.toml'), 'utf8');
    expect(config).toMatch(/\[auth\.email\.template\.email_change\]\s*\nsubject = "[^"]+"\s*\ncontent_path = "\.\/supabase\/templates\/email_change\.html"/);
    expect(readFileSync(join(__dirname, '../../supabase/templates/email_change.html'), 'utf8')).toContain('{{ .Token }}');
  });
});

describe('profileFor', () => {
  it('returns the profile result only when it belongs to the signed-in user', () => {
    const mine: ProfileState = { userId: 'user-a', status: 'loaded', profile: profileA };
    const theirs: ProfileState = { userId: 'user-b', status: 'loaded', profile: null };
    expect(profileFor(session, mine)).toBe(mine);
    expect(profileFor(session, theirs)).toBeNull();
    expect(profileFor(null, mine)).toBeNull();
  });
});

describe('authErrorMessage', () => {
  it('explains the sign-in function’s answers (T147)', () => {
    expect(authErrorMessage({ code: 'wrong_username_or_password' })).toBe('Username or password is incorrect.');
    expect(authErrorMessage({ code: 'too_many_attempts' })).toBe(
      'Too many wrong passwords for this username. Sign in with your email, or try again in an hour.',
    );
    expect(authErrorMessage({ code: 'try_later' })).toBe('Couldn’t sign in just now. Wait a minute and try again.');
  });

  it('explains wrong credentials without saying which part was wrong', () => {
    expect(authErrorMessage({ code: 'invalid_credentials', name: 'AuthApiError' })).toBe(
      'Email or password is incorrect.',
    );
  });

  it('explains an unconfirmed email', () => {
    expect(authErrorMessage({ code: 'email_not_confirmed', name: 'AuthApiError' })).toBe(
      'Confirm your email first. Check your inbox for the code.',
    );
  });

  it('explains a network failure', () => {
    expect(authErrorMessage({ name: 'AuthRetryableFetchError' })).toBe(
      "Couldn't reach Kept. Check your connection and try again.",
    );
  });

  it('explains a wrong or expired code the same way', () => {
    expect(authErrorMessage({ code: 'otp_expired', name: 'AuthApiError' })).toBe(CODE_MESSAGE);
    expect(CODE_MESSAGE).toBe("That code didn't work. Check it or send a new one.");
  });

  it('explains the email rate limit (code resends and sign-ups)', () => {
    expect(authErrorMessage({ code: 'over_email_send_rate_limit', name: 'AuthApiError' })).toBe(
      'Too many emails sent. Wait a minute and try again.',
    );
  });

  it('explains the request rate limit (too many code attempts)', () => {
    expect(authErrorMessage({ code: 'over_request_rate_limit', name: 'AuthApiError' })).toBe(
      'Too many tries. Wait a minute and try again.',
    );
  });

  it('explains a password the server rejects as weak with the same rule the form uses', () => {
    expect(authErrorMessage({ code: 'weak_password', name: 'AuthWeakPasswordError' })).toBe(PASSWORD_RULE_MESSAGE);
    expect(PASSWORD_RULE_MESSAGE).toBe(
      'Use at least 8 characters, with a lowercase letter, an uppercase letter, a number and a special character.',
    );
  });

  it('explains a new password that matches the old one', () => {
    expect(authErrorMessage({ code: 'same_password', name: 'AuthApiError' })).toBe(
      'That is your current password. Choose a new one.',
    );
  });

  it('says a reset code was sent without revealing whether the email has an account', () => {
    expect(RECOVERY_SENT_MESSAGE).toBe('If that email has an account, we sent a code.');
  });

  it('explains an email the server rejects with the same message the form uses', () => {
    expect(authErrorMessage({ code: 'email_address_invalid', name: 'AuthApiError' })).toBe(EMAIL_FORMAT_MESSAGE);
  });

  it("explains an address Supabase's built-in email won't send to", () => {
    expect(authErrorMessage({ code: 'email_address_not_authorized', name: 'AuthApiError' })).toBe(
      "Kept can't send email to that address yet. Try another email.",
    );
  });

  it('falls back to a plain sentence instead of a raw error', () => {
    expect(authErrorMessage({ code: 'unexpected_failure', name: 'AuthApiError', message: 'db timeout' })).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('handles a thrown non-Supabase error with the plain fallback', () => {
    expect(authErrorMessage({})).toBe('Something went wrong. Please try again.');
  });
});

describe('isAppleCancel (T10: closing Apple’s sheet shows no error)', () => {
  it('is true only for the user cancelling', () => {
    expect(isAppleCancel({ code: 'ERR_REQUEST_CANCELED' })).toBe(true);
    expect(isAppleCancel({ code: 'ERR_REQUEST_FAILED' })).toBe(false);
    expect(isAppleCancel(new Error('boom'))).toBe(false);
    expect(isAppleCancel(null)).toBe(false);
  });
});

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes through an answer that arrives in time', async () => {
    await expect(withTimeout(Promise.resolve('row'), 1000)).resolves.toBe('row');
  });

  it('passes through a failure that arrives in time', async () => {
    await expect(withTimeout(Promise.reject(new Error('refused')), 1000)).rejects.toThrow('refused');
  });

  it('gives up on a call that never answers', async () => {
    const waiting = withTimeout(new Promise(() => {}), 1000);
    jest.advanceTimersByTime(1000);
    await expect(waiting).rejects.toEqual({ code: 'timeout' });
  });
});

describe('signUpErrorMessage', () => {
  it('says the email could not be sent when Supabase fails on its side', () => {
    expect(signUpErrorMessage({ code: 'unexpected_failure', message: 'Error sending confirmation email' })).toBe(SEND_CODE_FAILED_MESSAGE);
  });

  it('sends an email that already has an account to sign-in', () => {
    expect(signUpErrorMessage({ code: 'email_exists' })).toBe(EXISTING_ACCOUNT_MESSAGE);
    expect(signUpErrorMessage({ code: 'user_already_exists' })).toBe(EXISTING_ACCOUNT_MESSAGE);
  });

  it('leaves every other error to the shared sentences', () => {
    expect(signUpErrorMessage({ code: 'over_email_send_rate_limit' })).toBe(authErrorMessage({ code: 'over_email_send_rate_limit' }));
  });
});

describe('authErrorMessage, timeouts', () => {
  it('treats a timeout as a connection problem, not an unknown one', () => {
    expect(authErrorMessage({ code: 'timeout' })).toBe("Couldn't reach Kept. Check your connection and try again.");
  });
});
