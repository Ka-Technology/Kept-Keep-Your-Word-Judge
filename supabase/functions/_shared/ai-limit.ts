// The ceiling on a user's AI calls, and the time the AI steps in (plan.md decision 180, T240): Kept's AI is a
// last resort after friends and Kept's own grading, and nobody spends more than their share. Shared by the
// `ai-check` and `quiz` Edge Functions, Jest and the app's Settings, so it has no imports. The database's
// `ai_allowance()` (migration 0085) works out the same number from the same two constants.

/** AI calls a user gets, over a rolling 24 hours, for each stake challenge of theirs that hasn't ended. */
export const CALLS_PER_CHALLENGE = 3;
/**
 * The least anyone gets, so one Read challenge survives a failed quiz attempt (write, grade, write, grade). This is
 * production's rule. The database keeps the floor as a setting (migration 0088, `ai_settings.calls_floor`, seeded at 4):
 * the test project, which feeds the judges' TestFlight build, is raised by hand to 30, and nothing may go below 4.
 */
export const CALLS_FLOOR = 4;

/** A user's allowance of AI calls per rolling 24 hours, from how many stake challenges they have running. */
export function allowanceFor(activeStakeChallenges: number): number {
  const n = Number.isFinite(activeStakeChallenges) ? Math.floor(activeStakeChallenges) : 0;
  return Math.max(CALLS_FLOOR, CALLS_PER_CHALLENGE * n);
}

/**
 * A check-in the AI never looked at because its user was over their limit: the first such day in a challenge
 * is excused, every later one is a miss the user can appeal (owner, 2026-11-03). The reason is what the
 * user reads. Excused sets no verdict, as every other excused day.
 */
export function overLimitUpdate(firstInChallenge: boolean): { status: 'excused' | 'rejected'; ai_verdict?: 'not_approved'; ai_reason: string } {
  return firstInChallenge
    ? { status: 'excused', ai_reason: 'Kept’s AI had reached its limit for you today, so this day counts without being checked.' }
    : { status: 'rejected', ai_verdict: 'not_approved', ai_reason: 'Kept’s AI had reached its daily limit for you, so this day wasn’t checked. You can appeal it.' };
}

/** When the AI steps in unless the user chose another time, in minutes after midnight: 10 pm (SPEC-verification.md decision 4). */
export const DEFAULT_STEP_IN = 22 * 60;
/** The earliest the AI may step in: 9:00 pm (owner, 2026-11-03; it was 10 pm). */
export const EARLIEST_STEP_IN = 21 * 60;
const MIDNIGHT = 24 * 60;

/** Whether `value` is a time the AI may step in: any whole minute from 9:00 pm to midnight (the database checks the same). */
export function isStepIn(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= EARLIEST_STEP_IN && value <= MIDNIGHT;
}

/**
 * A time off the Settings dial (minutes after midnight on the clock) as a step-in time: 12:00 am is midnight, the
 * end of the day, and anything before 9 pm is 9 pm.
 */
export function stepInFromClock(minutes: number): number {
  return minutes === 0 ? MIDNIGHT : Math.min(MIDNIGHT - 1, Math.max(EARLIEST_STEP_IN, minutes));
}

/** "10:15 pm", or "Midnight". */
export function stepInLabel(minutes: number): string {
  if (minutes >= MIDNIGHT) return 'Midnight';
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

/** How long a challenger has to retake a photo the AI asks for, which only works while the day is open. */
export function retakeWindowText(minutes: number): string {
  const left = Math.max(0, MIDNIGHT - minutes);
  if (left === 0) return 'No retakes: the AI decides at midnight';
  const hours = Math.floor(left / 60);
  const rest = left % 60;
  const parts = [hours && `${hours} hour${hours > 1 ? 's' : ''}`, rest && `${rest} minute${rest > 1 ? 's' : ''}`].filter(Boolean);
  return `Retakes until midnight: ${parts.join(' ')}`;
}

/** When the quiz opens: the choice, but never later than 11 pm, since a quiz needs time to take. */
export function quizOpensAt(minutes: number): number {
  return Math.min(minutes, MIDNIGHT - 60);
}

/** A time in a sentence: "10 pm", "10:15 pm", "midnight". */
export function stepInPhrase(minutes: number): string {
  if (minutes >= MIDNIGHT) return 'midnight';
  return stepInLabel(minutes).replace(':00', '');
}

/** The saved step-in time, or 10 pm when it's missing or not a valid time (an app built before the database change reads nothing). */
export function stepInOrDefault(value: unknown): number {
  return isStepIn(value) ? value : DEFAULT_STEP_IN;
}
