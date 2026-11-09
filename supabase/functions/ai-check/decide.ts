// What one due check-in becomes (T27-T28, SPEC-verification.md; plan.md decision 180, T244). The AI is a last
// resort behind a per-user ceiling: it's asked only when nothing else decides the day, and only if the user
// still has a call to spend. Over the ceiling, no call is made: the first such day in a challenge is excused,
// every later one is a miss the user can appeal. A call Kept itself fails to make is given back. Everything
// outside is injected (`Io`), so Jest tries every path without a network (decide.test.ts); index.ts supplies the
// real ones.

import { overLimitUpdate } from '../_shared/ai-limit.ts';
import { quizText, type Quiz } from '../_shared/quiz.ts';
import { checkText, noQuizUpdate, outcome, photoUnreadable, unreadableUpdate, type Verdict } from './rules.ts';

/** A check-in ai_check_claim() took (migration 0085), with what the AI needs and whose it is. */
export type Due = {
  id: string;
  habit_id: string;
  day: number;
  photo_path: string | null;
  photo_taken_at: string | null;
  time_zone: string;
  flag_note: string | null;
  retake_asked: boolean;
  day_ended: boolean;
  book: string | null;
  quiz: Quiz | null;
  user_id: string;
  challenge_id: string;
};

export type Io = {
  /** A short-lived link to the photo; throws a PhotoUnreadable when the file is missing. */
  photoUrl(path: string): Promise<string>;
  /** One of the user's AI calls (null: they've used today's allowance). */
  take(user: string): Promise<number | null>;
  /** Gives a call back. */
  release(call: number): Promise<void>;
  /** Whether this day is the challenge's first one the AI never looked at (it passes; any later one is a miss). */
  firstOverLimitDay(challenge: string, day: number): Promise<boolean>;
  /** Asks Claude whether the image (none for Learn a language) shows the habit's check. */
  ask(imageUrl: string | null, text: string): Promise<{ verdict: Verdict; reason: string }>;
  warn(...args: unknown[]): void;
};

/** The check-in's update, and the verdict to log (no personal data) when the AI gave one. */
export async function decideCheckIn(c: Due, io: Io, model: string): Promise<{ update: Record<string, unknown>; log?: Record<string, unknown> }> {
  let update: Record<string, unknown> = { status: 'excused' };
  let log: Record<string, unknown> | undefined;
  const canRetake = !!c.photo_path && !c.retake_asked && !c.day_ended;
  let call: number | null = null;
  let spent = false;
  try {
    const answered = !!c.quiz && !!quizText(c.quiz);
    if (!c.photo_path && !answered && c.habit_id === 'language') {
      update = noQuizUpdate(c.quiz);
    } else if (!c.photo_path && !answered) {
      // A check-in from before photos were required (0038): nothing to look at, so approved as unsure.
      update = { status: outcome('unsure', false), ai_verdict: 'unsure' };
    } else {
      // The photo first: one that can't be read costs the user nothing.
      const image = c.photo_path ? await io.photoUrl(c.photo_path) : null;
      call = await io.take(c.user_id);
      if (call === null) {
        update = overLimitUpdate(await io.firstOverLimitDay(c.challenge_id, c.day));
      } else {
        const { verdict, reason } = await io.ask(image, checkText(c));
        spent = true;
        const status = outcome(verdict, canRetake);
        // The column holds 500 characters; a longer reason would leave the row to be excused.
        update = { status, ai_verdict: verdict, ai_reason: reason.slice(0, 500), ai_model: model };
        log = { habit: c.habit_id, verdict, status, reason, model };
      }
    }
  } catch (e) {
    if (photoUnreadable(e)) update = unreadableUpdate(canRetake);
    io.warn(photoUnreadable(e) ? 'ai-check: photo unreadable' : 'ai-check: verdict failed, counted as done', c.id, e);
    // Kept's failure, not the user's: the call goes back.
    if (call !== null && !spent) await io.release(call).catch(() => {});
  }
  return { update, log };
}
