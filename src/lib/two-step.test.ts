// Two-step verification (T161): when a signed-in session still needs its authenticator code.
import { getAuthState } from './auth-state';
import { jwtAal, needsTwoStep, recoverySendMessage, twoStepErrorMessage } from './two-step';

/** An unsigned JWT with `claims` as its payload, as Supabase's access token carries them. */
const token = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
const totp = (status: string) => ({ factor_type: 'totp', status });

describe('jwtAal', () => {
  it('reads the assurance level from the access token, or null if it can’t', () => {
    expect(jwtAal(token({ aal: 'aal1' }))).toBe('aal1');
    expect(jwtAal(token({ aal: 'aal2', sub: 'ü' }))).toBe('aal2');
    expect(jwtAal('not-a-token')).toBeNull();
  });
});

describe('needsTwoStep', () => {
  it('asks for the code once a verified authenticator is on and the session hasn’t used it', () => {
    expect(needsTwoStep({ access_token: token({ aal: 'aal1' }), user: { factors: [totp('verified')] } })).toBe(true);
    expect(needsTwoStep({ access_token: token({ aal: 'aal2' }), user: { factors: [totp('verified')] } })).toBe(false);
  });

  it('never asks without a verified authenticator, or signed out', () => {
    expect(needsTwoStep({ access_token: token({ aal: 'aal1' }), user: { factors: [totp('unverified')] } })).toBe(false);
    expect(needsTwoStep({ access_token: token({ aal: 'aal1' }), user: {} })).toBe(false);
    expect(needsTwoStep(null)).toBe(false);
  });

  it('holds the app on the code screen until then', () => {
    const session = { user: { id: 'u1' } };
    const profileState = { userId: 'u1', status: 'loaded' as const, profile: null };
    expect(getAuthState({ sessionStatus: 'loaded', session, profileState, twoStep: true })).toBe('two-step');
    expect(getAuthState({ sessionStatus: 'loaded', session, profileState, twoStep: false })).toBe('needs-profile');
  });
});

describe('twoStepErrorMessage', () => {
  it('says plainly what went wrong', () => {
    expect(twoStepErrorMessage({ code: 'mfa_verification_failed' })).toBe('That code didn’t work. Check your authenticator app and try again.');
    expect(twoStepErrorMessage({})).toBe('Couldn’t reach Kept. Check your connection and try again.');
    expect(twoStepErrorMessage({ code: 'something_else', message: 'boom' })).toBe('That didn’t work. Please try again.');
  });
});

describe('recoverySendMessage', () => {
  it('says a code is on its way when one was just sent, not that sending failed', () => {
    expect(recoverySendMessage('wait_a_minute')).toContain('just emailed');
  });

  it('says the email failed for anything else, without asking to wait a minute', () => {
    for (const code of ['email_failed', 'email_not_configured', undefined]) {
      expect(recoverySendMessage(code)).toBe('Couldn’t send the email. Try again in a little while.');
    }
  });
});
