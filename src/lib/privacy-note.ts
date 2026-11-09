// Kept's AI and your check-ins (SPEC-verification.md; T54). When the account is made (sign-up's
// About you, or complete-profile; decision 96), the app asks whether Kept's AI may check their
// days, with Allow and Don't allow and neither preselected (App Review guideline 5.1.2(i)); an
// account from before that is asked before its first check-in. The answer is profiles.ai_allowed,
// so the AI job and the quiz function can honor it (migration 0036); Settings → Privacy & security
// shows and changes it. The time the AI steps in is the user's own (profiles.ai_from_minutes; 10 pm unless they
// chose later, plan.md decision 180).

import { DEFAULT_STEP_IN, stepInPhrase } from '../../supabase/functions/_shared/ai-limit';

/** The question, as the choice's title. */
export const AI_CHOICE_TITLE = 'Let Kept’s AI check your days?';

/**
 * What each answer means, shown with the question. Short enough to read in a phone alert (owner,
 * 2026-10-01): who gets what and why, and what Don't allow costs. The quiz and the 30-day photo
 * deletion are in Settings → Privacy & security (CHECK_IN_PRIVACY_NOTE) and the privacy policy.
 */
export const AI_CHOICE_MESSAGE =
  'If no friend approves a check-in by 10 pm, Kept’s AI checks it. Your photo and answers go to Anthropic only for that, never to train AI.\n\n' +
  'Without it, a day no friend approves counts as missed. Change it any time in Settings.';

/** Where the user stands, in a sentence, for Settings. */
export function aiChoiceSummary(allowed: boolean | null, stepInMinutes: number = DEFAULT_STEP_IN): string {
  if (allowed === null) return 'You’ll be asked before your first check-in.';
  return allowed
    ? `Kept’s AI checks a day no friend has approved by ${stepInPhrase(stepInMinutes)}.`
    : 'Only friends who back you check your days. A day none of them approves by midnight counts as missed.';
}

/** Settings' note on what goes to the AI provider when the user allowed it. */
export const CHECK_IN_PRIVACY_NOTE =
  'If you allow Kept’s AI, check-in photos, quiz answers and the line you may write on a language quiz may be sent to an AI provider (Anthropic) to check your day or write your questions. They’re used only for that, not to train AI models, and photos are deleted 30 days after the challenge ends.';
