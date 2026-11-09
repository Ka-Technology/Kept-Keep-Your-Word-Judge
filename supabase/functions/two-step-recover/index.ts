// Recovering two-step verification by an email code (T161): someone who turned it on and lost their authenticator
// app signs in with their password (an aal1 session), asks for a code by email, and enters it; the authenticator
// is then removed, so they sign in with the password alone and can turn two-step back on. The app calls it with
// the user's token:
//   { action: 'send' }           emails a 6-digit code to the account's address (once a minute at most); only its
//                                hash is stored (two_step_recovery, migration 0077)
//   { action: 'verify', code }   the right code, within 15 minutes and 5 tries, deletes the account's authenticator
//                                factors (Supabase's admin API) and the code; answers { done: true } or { error }
// Secret: RESEND_API_KEY (the auth email's Resend key, as `notify` uses).

import { withSupabase } from 'npm:@supabase/server@^1';

import { canResend, CODE_MINUTES, codeFrom, recoveryCheck, recoveryEmail } from './rules.ts';

/** A code's SHA-256, salted with whose it is, so a stored hash says nothing on its own. */
async function hash(userId: string, code: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userId}:${code}`));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const body = await req.json().catch(() => ({}));
    const userId = ctx.userClaims!.id;
    const admin = ctx.supabaseAdmin;
    const { data: row, error } = await admin.from('two_step_recovery').select('code_hash, expires_at, attempts, created_at').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    const now = new Date();

    if (body.action === 'send') {
      if (!canResend(row, now)) return Response.json({ error: 'wait_a_minute' }, { status: 429 });
      const { data: user, error: userError } = await admin.auth.admin.getUserById(userId);
      if (userError || !user.user?.email) return Response.json({ error: 'no_email' }, { status: 400 });
      // Before a code is saved: a failure here mustn't start the minute's wait, or the next try says "wait".
      const key = Deno.env.get('RESEND_API_KEY');
      if (!key) {
        console.error('two-step-recover: RESEND_API_KEY is not set');
        return Response.json({ error: 'email_not_configured' }, { status: 503 });
      }
      const code = codeFrom(crypto.getRandomValues(new Uint32Array(1))[0]);
      const { error: saveError } = await admin.from('two_step_recovery').upsert({
        user_id: userId,
        code_hash: await hash(userId, code),
        expires_at: new Date(now.getTime() + CODE_MINUTES * 60_000).toISOString(),
        attempts: 0,
        created_at: now.toISOString(),
      });
      if (saveError) throw saveError;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(recoveryEmail(user.user.email, code)),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      // Not sent, so no code stands and no minute's wait: the next try sends one.
      if (!res?.ok) {
        console.error('two-step-recover: Resend refused', res?.status, await res?.text());
        await admin.from('two_step_recovery').delete().eq('user_id', userId);
        return Response.json({ error: 'email_failed' }, { status: 502 });
      }
      return Response.json({ sent: true });
    }

    if (body.action === 'verify' && typeof body.code === 'string') {
      const step = recoveryCheck(row, now, !!row && row.code_hash === (await hash(userId, body.code.trim())));
      if (step !== 'ok') {
        if (row && step === 'invalid_code') await admin.from('two_step_recovery').update({ attempts: row.attempts + 1 }).eq('user_id', userId);
        return Response.json({ error: step }, { status: 400 });
      }
      const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors({ userId });
      if (listError) throw listError;
      for (const factor of factors.factors) {
        const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
        if (deleteError) throw deleteError;
      }
      await admin.from('two_step_recovery').delete().eq('user_id', userId);
      return Response.json({ done: true });
    }

    return Response.json({ error: 'unknown_request' }, { status: 400 });
  }),
};
