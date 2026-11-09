// The ceiling on a user's AI calls, as the Edge Functions use it (plan.md decision 180, T244): the three
// database calls of migration 0085. `ai-check` and `quiz` take a call before they ask the AI, give it back when
// Kept itself fails, and ask which kind of over-limit day it is. Tested in ai-calls.test.ts with a fake client.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2';

/** What a call was for (ai_usage.kind). */
export type CallKind = 'photo' | 'quiz_write' | 'quiz_grade' | 'bank';

/**
 * Records one AI call for `user` and returns its id, or null when they've used their allowance over the last
 * 24 hours (3 for each active stake challenge, at least 4). Throws on a database error: the caller counts that
 * as Kept's failure, never as a free pass for the user or a refusal.
 */
export async function takeCall(admin: SupabaseClient, user: string, kind: CallKind): Promise<number | null> {
  const { data, error } = await admin.rpc('ai_take', { uid: user, what: kind });
  if (error) throw error;
  return data as number | null;
}

/** Gives a call back, since Kept failed to make it. Never throws: a call that stays counted is a small cost. */
export async function releaseCall(admin: SupabaseClient, call: number): Promise<void> {
  const { error } = await admin.rpc('ai_release', { call });
  if (error) console.error('ai: couldn’t give a call back', call, error);
}

/**
 * Whether `day` of a challenge is the one over-limit day that passes: the first to go over is let through, and
 * stays let through however often that same day is asked about (a quiz refused, then the deadline's decision);
 * every other day after it is a miss to appeal.
 */
export async function firstOverLimitDay(admin: SupabaseClient, challenge: string, day: number): Promise<boolean> {
  const { data, error } = await admin.rpc('ai_limit_day', { challenge, on_day: day });
  if (error) throw error;
  return data === true;
}
