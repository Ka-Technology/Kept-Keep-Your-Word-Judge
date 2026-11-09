// Sign in with a username (T147, plan.md decision 102, SPEC-identity.md). The app sends
// { username, password } signed out; this finds the account's email on the server (it never reaches
// the app), signs in with it, and answers with the session for the app's setSession(). Answers:
//   { access_token, refresh_token }                 signed in;
//   { error: 'wrong_username_or_password' } (400)   no such username, or the wrong password (one answer
//                                                   for both; Apple and Google accounts have no password);
//   { error: 'too_many_attempts' } (429)            10 wrong passwords for this account in the last hour
//                                                   (sign_in_failures, 0051); email, Apple, Google and
//                                                   Face ID still work;
//   { error: 'try_later' } (503)                    Supabase Auth refused for another reason, e.g. its
//                                                   rate limit.
// `auth: 'none'`: the caller is signed out, and like Supabase's own sign-in this is open to anyone
// (config.toml turns off the platform's JWT check). ctx.supabase is the anonymous client.
// ponytail: every username sign-in reaches Supabase Auth from this function's address, so they share
// its per-address sign-in limit (30 in 5 minutes by default); raise it in the dashboard if usage outgrows it.

import { withSupabase } from 'npm:@supabase/server@^1';

import { blocked, usernameFrom, windowStart } from './sign-in.ts';

const wrong = () => Response.json({ error: 'wrong_username_or_password' }, { status: 400 });

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    const body = await req.json().catch(() => ({}));
    const username = usernameFrom(body.username);
    if (!username || typeof body.password !== 'string' || !body.password) return wrong();
    const admin = ctx.supabaseAdmin;

    const { data: profile, error: lookupError } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
    if (lookupError) throw lookupError;
    if (!profile) return wrong();

    // Each try is written down before it's made and counts as a failure until it succeeds, so tries
    // sent all at once can't each find the count under the limit (review, 2026-10-18).
    const since = windowStart(Date.now());
    // Rows past the hour no longer count; dropping them keeps a long attack from growing the table.
    await admin.from('sign_in_failures').delete().eq('user_id', profile.id).lt('failed_at', since);
    const { data: attempt, error: attemptError } = await admin.from('sign_in_failures').insert({ user_id: profile.id }).select('failed_at').single();
    if (attemptError) throw attemptError;
    const forget = () => admin.from('sign_in_failures').delete().eq('user_id', profile.id).eq('failed_at', attempt.failed_at);
    const { count, error: countError } = await admin
      .from('sign_in_failures')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .gte('failed_at', since);
    if (countError) throw countError;
    // The tries before this one; a refused try isn't kept, so waiting out the hour always works.
    if (blocked((count ?? 1) - 1)) {
      await forget();
      return Response.json({ error: 'too_many_attempts' }, { status: 429 });
    }

    const { data: found, error: userError } = await admin.auth.admin.getUserById(profile.id);
    if (userError) throw userError;
    const email = found.user?.email;
    if (!email) return wrong();

    const { data, error } = await ctx.supabase.auth.signInWithPassword({ email, password: body.password });
    if (error) {
      if (error.code !== 'invalid_credentials') {
        console.error('sign-in: Supabase Auth refused', error.status, error.code);
        await forget();
        return Response.json({ error: 'try_later' }, { status: 503 });
      }
      // The wrong password: this try stays counted.
      return wrong();
    }
    // A right password starts the count again.
    await admin.from('sign_in_failures').delete().eq('user_id', profile.id);
    return Response.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  }),
};
