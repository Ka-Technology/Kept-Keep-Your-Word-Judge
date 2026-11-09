// The rules behind a photo check-in (SPEC-verification.md, T25): what each habit checks in with,
// where a photo is stored, Kept's stamp (the time code), each status in words, and how far a photo
// is shrunk. Pure: no React or Supabase imports (tested in check-in.test.ts).

import type { CheckInStatus } from './challenge-rules';

/**
 * What a habit checks in with (SPEC-verification.md's table): Kept's camera; a screenshot, when the
 * proof is a screen on the same phone; either; or nothing until Learn a language's quiz (T42).
 */
export type Evidence = 'camera' | 'screenshot' | 'either' | 'none';

const EVIDENCE: Record<string, Evidence> = {
  meditate: 'screenshot',
  steps: 'screenshot',
  'walk-run': 'either',
  study: 'either',
  leetcode: 'either',
  // Off the list since 0044, for challenges started before it.
  write: 'either',
  code: 'either',
  chess: 'either',
  bike: 'either',
  language: 'none',
};

/** What this habit checks in with; every habit not listed above needs Kept's camera. */
export function evidenceFor(habitId: string): Evidence {
  return EVIDENCE[habitId] ?? 'camera';
}

/** What a friend's "doesn't look right" asks for, by the habit's evidence. */
const REDO: Record<Evidence, string> = {
  camera: 'for a new photo',
  screenshot: 'for a new screenshot',
  either: 'for a new photo or screenshot',
  none: 'you to check in again',
};

/** Where a check-in photo goes: `{user}/{challenge}/{day}-{time}.jpg`, the folder the database requires. */
export function checkInPhotoPath(userId: string, challengeId: string, day: number, now: number): string {
  return `${userId}/${challengeId}/${day}-${now}.jpg`;
}

/**
 * How many pages a Read check-in's range covers ("140 to 160", "40–62", "pp. 1-30": the end minus the
 * start), for the book tile on a sent check-in (T102). Null when it isn't a forward range.
 */
export function pagesRead(pages: string | null): number | null {
  const match = pages?.match(/(\d+)\s*(?:-|–|—|to)\s*(\d+)/);
  if (!match) return null;
  const count = Number(match[2]) - Number(match[1]);
  return count > 0 ? count : null;
}

/**
 * Kept's stamp on a photo, "Day 5 · Tue, Sep 29 · 7:42 PM", in the challenge's time zone and the
 * phone's language. `withTime` false leaves out the time (before a photo is taken).
 */
export function stampText(day: number, when: Date, timeZone: string, withTime = true, locale?: string): string {
  const format = (options: Intl.DateTimeFormatOptions) => {
    try {
      return when.toLocaleString(locale, { ...options, timeZone });
    } catch {
      // ponytail: without Intl time zones, the phone's own zone (only wrong for a challenger who moved zones).
      return when.toLocaleString(locale, options);
    }
  };
  const date = format({ weekday: 'short', month: 'short', day: 'numeric' });
  return withTime ? `Day ${day} · ${date} · ${format({ hour: 'numeric', minute: '2-digit' })}` : `Day ${day} · ${date}`;
}

const STATUS_TEXT: Record<CheckInStatus, string> = {
  pending: 'Waiting for a friend',
  flagged: 'A friend asked for a new photo',
  ai_checking: 'The AI is checking this',
  retake: 'Take a new photo',
  approved: 'Approved',
  rejected: 'Not approved',
  appealed: 'Appeal pending',
  excused: 'Restored by Kept',
};

/** A check-in's status in words, for the challenger. */
export function checkInStatusText(status: CheckInStatus): string {
  return STATUS_TEXT[status];
}

/**
 * A check-in's status with who decided it: "Approved by @sam.lee", "Approved by Kept’s AI" when
 * `byAI` (see decidedByAI), or "@sam.lee asked for a new photo" and "Kept’s AI asked for a new
 * photo" (a new screenshot, or to check in again, by the habit's `evidence`). `onDoubt` (see aiApprovedOnDoubt)
 * is an approval the AI wasn't sure of, which says so.
 */
export function reviewedStatusText(
  status: CheckInStatus,
  reviewer: string | null | undefined,
  byAI = false,
  evidence: Evidence = 'camera',
  onDoubt = false,
): string {
  if (byAI && onDoubt && status === 'approved') return 'Counted as kept: Kept’s AI couldn’t tell';
  if (byAI && status === 'approved') return 'Approved by Kept’s AI';
  if (reviewer && status === 'approved') return `Approved by @${reviewer}`;
  if (status === 'flagged') return `${reviewer ? `@${reviewer}` : 'A friend'} asked ${REDO[evidence]}`;
  if (status === 'retake') return `Kept’s AI asked ${REDO[evidence]}`;
  return checkInStatusText(status);
}

/**
 * An approval the AI itself wasn't sure of: it asked for a retake or couldn't tell, and with no retake left (the
 * day had ended) Kept counts the day, since the AI never fails anyone on a guess (SPEC-verification.md). It isn't
 * an approval of the photo, so the screen doesn't call it one.
 */
export function aiApprovedOnDoubt(c: { status: CheckInStatus; ai_verdict?: string | null }): boolean {
  return c.status === 'approved' && (c.ai_verdict === 'retake' || c.ai_verdict === 'unsure');
}

/**
 * Whether Kept's AI made the latest decision on a check-in: it acted (T27) after any friend's
 * review, as when a friend's flag got no new photo. A friend who approves after the AI's retake wins.
 */
export function decidedByAI(c: { reviewed_at?: string | null; ai_checked_at?: string | null }): boolean {
  return !!c.ai_checked_at && (!c.reviewed_at || Date.parse(c.ai_checked_at) > Date.parse(c.reviewed_at));
}

const APPEAL_DAYS = 7;

/**
 * Whether the challenger may appeal this check-in (T29), as the database decides: once, on a day the
 * AI rejected, within 7 days of the rejection.
 */
export function canAppeal(c: { status: CheckInStatus; appealed_at: string | null; ai_checked_at: string | null }, now: Date): boolean {
  return (
    c.status === 'rejected' &&
    !c.appealed_at &&
    !!c.ai_checked_at &&
    now.getTime() - Date.parse(c.ai_checked_at) < APPEAL_DAYS * 24 * 60 * 60 * 1000
  );
}

/** The resize that brings a photo's long side down to `max` px (1000, about 150 KB), or null if it's already small enough. */
export function resizeTo(width: number, height: number, max = 1000): { width: number | null; height: number | null } | null {
  if (Math.max(width, height) <= max) return null;
  return width >= height ? { width: max, height: null } : { width: null, height: max };
}

/** What the quiz says on a day that counts without one because Kept's AI had no call left for the user (plan.md decision 180). */
export const QUIZ_LIMITED_NOTE = 'You’ve reached today’s limit for Kept’s AI, so this quiz can’t be graded. Just this once, this day counts.';

/**
 * What to tell the user when the quiz function couldn't make or grade a quiz, by the error code it answered:
 * the limit was reached, the quiz isn't open yet (`opensAt`, in words), another request is already making it,
 * or anything else, by whether answers (`answering`) or questions were being asked for.
 */
export function quizProblem(code: string | undefined, { answering, opensAt }: { answering: boolean; opensAt: string }): string {
  if (code === 'ai_limit') return 'You’ve reached today’s limit for Kept’s AI. A friend can still approve this day.';
  if (code === 'quiz_not_open') return `The quiz opens at ${opensAt}, so friends get the first chance.`;
  if (code === 'quiz_busy') return 'Kept is already making your quiz. Give it a moment.';
  return answering ? 'Your answers couldn’t be checked. Try again.' : 'The quiz couldn’t be made. Try again, or a friend checks this day instead.';
}
