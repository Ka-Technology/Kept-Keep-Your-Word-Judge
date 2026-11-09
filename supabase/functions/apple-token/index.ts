// Sign in with Apple's refresh token, kept so it can be revoked (T10; App Review: deleting an account
// must revoke its Apple tokens, and Supabase doesn't). The app calls it with the user's token:
//   { authorizationCode }: right after an Apple sign-in, exchanges Apple's one-time code (valid for
//     5 minutes) for a refresh token and keeps it in apple_tokens (migration 0037);
//   { revoke: true }: before the account is deleted, revokes that refresh token with Apple and
//     forgets it.
// The client secret is an ES256 JWT (apple.ts) signed with the Sign in with Apple key. Secrets:
// APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (the .p8 file's text) and APPLE_CLIENT_ID (the
// bundle ID, com.habitkept.ios). Without them it answers `apple_not_configured` and changes nothing.

import { withSupabase } from 'npm:@supabase/server@^1';

import { base64url, clientSecretClaims, pemBody, signingInput } from './apple.ts';

const APPLE = 'https://appleid.apple.com/auth';

/** A fresh client secret, or null if the Apple secrets aren't set. */
async function clientSecret(): Promise<{ clientId: string; secret: string } | null> {
  const [teamId, keyId, clientId, privateKey] = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_CLIENT_ID', 'APPLE_PRIVATE_KEY'].map((n) => Deno.env.get(n));
  if (!teamId || !keyId || !clientId || !privateKey) return null;
  const { header, payload } = clientSecretClaims({ teamId, keyId, clientId }, Math.floor(Date.now() / 1000));
  const input = signingInput(header, payload);
  const key = await crypto.subtle.importKey('pkcs8', pemBody(privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // Web Crypto's ECDSA signature is already JWS's raw r || s form.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input));
  return { clientId, secret: `${input}.${base64url(new Uint8Array(signature))}` };
}

/** POSTs a form to one of Apple's endpoints. */
function post(path: 'token' | 'revoke', form: Record<string, string>): Promise<Response> {
  return fetch(`${APPLE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const body = await req.json();
    const userId = ctx.userClaims!.id;
    const admin = ctx.supabaseAdmin;
    const client = await clientSecret();
    if (!client) return Response.json({ error: 'apple_not_configured' }, { status: 503 });

    if (typeof body.authorizationCode === 'string') {
      const res = await post('token', {
        client_id: client.clientId,
        client_secret: client.secret,
        code: body.authorizationCode,
        grant_type: 'authorization_code',
      });
      const token = (await res.json()) as { refresh_token?: string; error?: string };
      if (!res.ok || !token.refresh_token) {
        console.error('apple-token: code exchange refused', res.status, token.error);
        return Response.json({ error: 'exchange_failed' }, { status: 502 });
      }
      const { error } = await admin
        .from('apple_tokens')
        .upsert({ user_id: userId, refresh_token: token.refresh_token, updated_at: new Date().toISOString() });
      if (error) throw error;
      return Response.json({ stored: true });
    }

    if (body.revoke === true) {
      const { data, error } = await admin.from('apple_tokens').select('refresh_token').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      if (!data) return Response.json({ revoked: false });
      const res = await post('revoke', {
        client_id: client.clientId,
        client_secret: client.secret,
        token: data.refresh_token,
        token_type_hint: 'refresh_token',
      });
      if (!res.ok) {
        console.error('apple-token: revoke refused', res.status);
        return Response.json({ error: 'revoke_failed' }, { status: 502 });
      }
      await admin.from('apple_tokens').delete().eq('user_id', userId);
      return Response.json({ revoked: true });
    }

    return Response.json({ error: 'unknown_request' }, { status: 400 });
  }),
};
