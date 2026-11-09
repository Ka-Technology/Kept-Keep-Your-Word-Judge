// Send feedback (T158; SPEC-app-shell.md, "Feedback"): what a message can be about, the checks before
// it's sent, where its photo goes, and the database's refusals as plain sentences. Migration 0053
// enforces the same kinds and limit (feedback.test.ts reads it to keep them the same). Pure: no React
// or Supabase imports.

/** What feedback can be about, in the order the form shows them. `value` is what the database stores. */
export const FEEDBACK_KINDS = [
  { value: 'bug', label: 'Bug', placeholder: 'What happened, and what did you expect?' },
  { value: 'idea', label: 'Idea', placeholder: 'What would make Kept better?' },
  { value: 'habit', label: 'Habit', placeholder: 'Which habit should Kept add? How would you check in?' },
  { value: 'other', label: 'Other', placeholder: 'Tell us anything.' },
] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]['value'];

/** The longest message, in characters after trimming (the feedback table's check). */
export const FEEDBACK_MAX = 2000;

/** Why this can't be sent yet, or null when it can. The message is trimmed, as the database counts it. */
export function feedbackProblem(kind: FeedbackKind | null, message: string): string | null {
  if (!kind) return 'Pick what it’s about.';
  const length = message.trim().length;
  if (length === 0) return 'Write a message first.';
  if (length > FEEDBACK_MAX) return `Keep it under ${FEEDBACK_MAX} characters.`;
  return null;
}

/** Where a feedback photo goes: `{user}/{id}.jpg`, the folder the feedback bucket requires. */
export function feedbackPhotoPath(userId: string, id: string): string {
  return `${userId}/${id}.jpg`;
}

/** A plain sentence for refused feedback (never the raw database error). */
export function feedbackErrorMessage(error: { code?: string; message?: string }): string {
  if ((error.message ?? '').includes('feedback_rate_limited')) return 'That’s a lot of feedback in an hour. Try again later, or email hello@habitkept.com.';
  if (!error.code) return 'Couldn’t reach Kept. Check your connection and try again.';
  return 'Kept couldn’t send that. Please try again.';
}
