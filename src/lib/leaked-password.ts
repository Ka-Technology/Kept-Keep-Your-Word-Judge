// Whether a password has shown up in a known data breach, checked before sign-up, a reset or a
// change (security review, 2026-09-27). It uses Have I Been Pwned's Pwned Passwords by k-anonymity:
// only the first 5 characters of the password's SHA-1 hash leave the phone, never the password.
// Supabase's own check needs a paid plan (the security advisor flags it off); if it's ever turned
// on, authErrorMessage() gives the same message.

import * as Crypto from 'expo-crypto';

/** Whether a range reply ("SUFFIX:COUNT" lines) lists this hash suffix. Padding lines have a count of 0. */
export function inRange(body: string, suffix: string): boolean {
  const wanted = suffix.toUpperCase();
  return body.split('\n').some((line) => {
    const [listed, count] = line.trim().split(':');
    return listed === wanted && Number(count) > 0;
  });
}

/** True if the password is in a known breach; false if it isn't, or if the check couldn't run. */
export async function isLeakedPassword(password: string): Promise<boolean> {
  try {
    const hash = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, password)).toUpperCase();
    const reply = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } });
    if (!reply.ok) return false;
    return inRange(await reply.text(), hash.slice(5));
  } catch {
    // ponytail: fails open, so an outage never blocks sign-up; the password still meets every rule.
    return false;
  }
}
