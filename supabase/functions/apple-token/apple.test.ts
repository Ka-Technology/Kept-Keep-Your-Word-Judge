// Unit tests for apple.ts (T10): the client secret Apple's token and revoke endpoints expect, and the
// key and encoding helpers. Run with the app's jest.
import { base64url, clientSecretClaims, pemBody, signingInput } from './apple';

describe('clientSecretClaims (Apple: "Creating a client secret")', () => {
  it('is an ES256 JWT from the team, about the app, for Apple, short-lived', () => {
    expect(clientSecretClaims({ teamId: 'TEAM123456', keyId: 'KEY1234567', clientId: 'com.katech.kept' }, 1_800_000_000)).toEqual({
      header: { alg: 'ES256', kid: 'KEY1234567' },
      payload: { iss: 'TEAM123456', iat: 1_800_000_000, exp: 1_800_000_300, aud: 'https://appleid.apple.com', sub: 'com.katech.kept' },
    });
  });
});

describe('base64url', () => {
  it('encodes text and bytes without padding, + or /', () => {
    expect(base64url('{"alg":"ES256"}')).toBe('eyJhbGciOiJFUzI1NiJ9');
    expect(base64url(new Uint8Array([251, 255, 191]))).toBe('-_-_');
  });
});

describe('signingInput', () => {
  it('joins the encoded header and payload with a dot', () => {
    expect(signingInput({ alg: 'ES256' }, { a: 1 })).toBe('eyJhbGciOiJFUzI1NiJ9.eyJhIjoxfQ');
  });
});

describe('pemBody (the .p8 key Apple gives, as a secret)', () => {
  it('reads the key between the PEM lines, whatever the line breaks', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\r\nAQID\nBAU=\n-----END PRIVATE KEY-----\n';
    expect(Array.from(new Uint8Array(pemBody(pem)))).toEqual([1, 2, 3, 4, 5]);
  });

  it('accepts a key pasted with literal \\n sequences', () => {
    expect(Array.from(new Uint8Array(pemBody('-----BEGIN PRIVATE KEY-----\\nAQID\\n-----END PRIVATE KEY-----')))).toEqual([1, 2, 3]);
  });
});
