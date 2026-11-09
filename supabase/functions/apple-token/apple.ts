// The client secret Apple's token and revoke endpoints expect (T10; Apple's "Creating a client
// secret"): an ES256 JWT from Kept's team, about the app, signed with the Sign in with Apple key.
// Kept apart from the Edge Function so the app's jest tests it (apple.test.ts). Deno and jest both
// load it, so no imports; the signing itself (Web Crypto) is in index.ts.

/** The Sign in with Apple key's settings, from the function's secrets. `clientId` is the app's bundle ID. */
export type AppleKey = { teamId: string; keyId: string; clientId: string };

/** The client secret's header and claims, valid for 5 minutes from `now` (seconds). Apple allows up to 6 months. */
export function clientSecretClaims(key: AppleKey, now: number) {
  return {
    header: { alg: 'ES256', kid: key.keyId },
    payload: { iss: key.teamId, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: key.clientId },
  };
}

/** Base64url (JWT's alphabet, no padding) of text or bytes. */
export function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** What gets signed: the encoded header and payload, joined by a dot. */
export function signingInput(header: object, payload: object): string {
  return `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
}

/**
 * The key's bytes (PKCS #8) from the .p8 file's text, for Web Crypto. It tolerates real line breaks
 * and the literal "\n" a secret often ends up with when pasted on one line.
 */
export function pemBody(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
}
