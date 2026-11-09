// The AI check (T27-T28, SPEC-verification.md). Supabase Cron calls it every 15 minutes with the
// secret key. The app calls it with the user's token for "Next day (demo)" (`nextDay`, after which
// the day just ended is due like any other) and right after a new photo for a retake (checked at
// once). It takes the due check-ins (ai_check_claim, which moves them to ai_checking), answers at
// once, then asks Claude Haiku 4.5 about each in the background, five at a time (rules.ts). If Kept
// fails to ask, the day counts as done (excused); one left behind is excused by a later run. A photo
// that's missing or unreadable is the challenger's to fix, and a Learn a language day with no quiz
// taken isn't approved (review, 2026-10-04). Cron's runs also delete
// photos past their 30 days and deleted accounts' profile photos. A user may only run it on their
// own challenge. The AI is a last resort behind a per-user ceiling (plan.md decision 180): decide.ts
// takes one of the user's calls before each question to Claude, and an over-limit day is excused the
// first time in a challenge and a miss to appeal after. A waiting photo check is taken from the user's own
// step-in time (10 pm unless they chose later; ai_check_claim). The Anthropic key is the ANTHROPIC_API_KEY
// Supabase secret.

import Anthropic from 'npm:@anthropic-ai/sdk@^0.128.0';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@^0.128.0/helpers/zod';
import { withSupabase } from 'npm:@supabase/server@^1';
import { z } from 'npm:zod@^4';

import { firstOverLimitDay, releaseCall, takeCall } from '../_shared/ai-calls.ts';
import { decideCheckIn, type Due, type Io } from './decide.ts';
import { PhotoUnreadable, SYSTEM, type Verdict } from './rules.ts';

/** The Edge Runtime's background work: the instance stays up until the promise settles. */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const MODEL = 'claude-haiku-4-5';
/** A slow answer fails within 20 seconds instead of the SDK's 10 minutes (counted as Kept's failure). */
const anthropic = new Anthropic({ timeout: 20_000, maxRetries: 1 });
/** Check-ins asked about at once: a busy 10 pm stays under Anthropic's rate limit. */
const BATCH = 5;
const VerdictSchema = z.object({
  verdict: z.enum(['approve', 'retake', 'not_approved', 'unsure']),
  reason: z.string(),
});

/**
 * Asks Claude whether the image (none for Learn a language, judged from its quiz) shows the habit's
 * check (`text`, from checkText). Throws without a usable verdict.
 */
export async function askClaude(image: Anthropic.ImageBlockParam['source'] | null, text: string): Promise<{ verdict: Verdict; reason: string }> {
  const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text }];
  if (image) content.unshift({ type: 'image', source: image });
  const response = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    output_config: { format: zodOutputFormat(VerdictSchema) },
  });
  if (!response.parsed_output) throw new Error(`no verdict (stop_reason ${response.stop_reason})`);
  return response.parsed_output;
}

export default {
  fetch: withSupabase({ auth: ['user', 'secret'] }, async (req, ctx) => {
    const admin = ctx.supabaseAdmin;
    let only: string | null = null;
    if (ctx.authMode === 'user') {
      const { challengeId, nextDay } = await req.json();
      if (typeof challengeId !== 'string') return Response.json({ error: 'challengeId_required' }, { status: 400 });
      // Only the caller's own challenge (security review, 2026-10-01): nobody runs the check on someone else's.
      const { data: own, error: ownError } = await admin.from('challenges').select('id').eq('id', challengeId).eq('user_id', ctx.userClaims!.id).maybeSingle();
      if (ownError) throw ownError;
      if (!own) return Response.json({ error: 'not_your_challenge' }, { status: 404 });
      if (nextDay) {
        const { data: moved, error } = await admin.rpc('demo_next_day', { challenge: challengeId, challenger: ctx.userClaims!.id });
        if (error) throw error;
        if (!moved) return Response.json({ error: 'not_your_challenge' }, { status: 404 });
      }
      // Without nextDay, only this challenge's due check-ins are taken, which Cron would take anyway.
      only = challengeId;
    }

    const { data: due, error } = await admin.rpc('ai_check_claim', { only_challenge: only });
    if (error) throw error;

    /** What decide.ts needs from outside: the photo, the user's calls, and Claude. */
    const io: Io = {
      photoUrl: async (path) => {
        const { data, error } = await admin.storage.from('check-in-photos').createSignedUrl(path, 300);
        if (error) throw new PhotoUnreadable(error.message);
        return data.signedUrl;
      },
      take: (user) => takeCall(admin, user, 'photo'),
      release: (call) => releaseCall(admin, call),
      firstOverLimitDay: (challenge, day) => firstOverLimitDay(admin, challenge, day),
      ask: (url, text) => askClaude(url ? { type: 'url', url } : null, text),
      warn: (...args) => console.error(...args),
    };

    async function decide(c: Due) {
      const { update, log } = await decideCheckIn(c, io, MODEL);
      // The verdict log, without personal data, for measuring accuracy (SPEC.md open question 8).
      if (log) console.log(JSON.stringify({ ...log, at: new Date().toISOString() }));
      const { error } = await admin.from('check_ins').update(update).eq('id', c.id).eq('status', 'ai_checking');
      if (error) console.error('ai-check: verdict not saved, excused by a later run', c.id, error);
    }

    /** Check-in photos past their 30 days, and profile photos whose account is gone (0038). */
    async function deleteExpiredPhotos() {
      for (const [list, bucket] of [['expired_check_in_photos', 'check-in-photos'], ['orphan_avatars', 'avatars']]) {
        const expired = await admin.rpc(list);
        const removed = expired.data?.length ? await admin.storage.from(bucket).remove(expired.data) : null;
        if (expired.error || removed?.error) console.error(`ai-check: ${bucket} deletion failed, retried next run`, expired.error ?? removed?.error);
      }
    }

    async function decideAll(list: Due[]) {
      for (let i = 0; i < list.length; i += BATCH) await Promise.all(list.slice(i, i + BATCH).map(decide));
    }

    const work: Promise<void>[] = [decideAll(due as Due[])];
    if (ctx.authMode === 'secret') work.push(deleteExpiredPhotos());
    EdgeRuntime.waitUntil(Promise.all(work));
    return Response.json({ checking: due.length });
  }),
};
