// Sign in with a username (T147, decision 102): the `sign-in` Edge Function finds the account's email
// on the server and signs in there; the app gets only the session. Errors come back with a `code`
// for authErrorMessage(): the function's own (wrong_username_or_password, too_many_attempts,
// try_later), or none when the function can't be reached (or isn't deployed yet).

import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from './supabase';

/** Signs in, then hands back the account's email (for Face ID sign-in) or an error. */
export async function signInWithUsername(username: string, password: string): Promise<{ email?: string; error?: { code?: string; name?: string } }> {
  const { data, error } = await supabase.functions.invoke('sign-in', { body: { username, password } });
  if (error) {
    const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
    return { error: { code: typeof body?.error === 'string' ? body.error : undefined } };
  }
  const { data: signedIn, error: sessionError } = await supabase.auth.setSession(data);
  if (sessionError) return { error: sessionError };
  return { email: signedIn.user?.email };
}
