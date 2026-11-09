// Report, block and the word filter on the app side (T53; SPEC-friends.md, "Reports and blocks"):
// the reasons a report can give, the word list, and the database's refusals as plain sentences.
// Migration 0035 enforces the same list and reasons (moderation.test.ts reads it to keep them the
// same). Pure: no React or Supabase imports.

/**
 * Words Kept refuses in usernames, flag notes and appeal notes (App Review guideline 1.2's filter),
 * matched as whole words so "scunthorpe" passes. The owner can extend it; objectionable() in
 * migration 0035 must list the same words.
 */
export const OBJECTIONABLE_WORDS = [
  'asshole', 'bastard', 'bitch', 'bullshit', 'chink', 'cock', 'coon', 'cunt', 'dickhead', 'dyke',
  'fag', 'faggot', 'fuck', 'fucker', 'fucking', 'gook', 'kike', 'motherfucker', 'nigga', 'nigger',
  'paki', 'pedo', 'pedophile', 'porn', 'pussy', 'rape', 'rapist', 'retard', 'retarded', 'shit',
  'slut', 'spic', 'tranny', 'twat', 'wank', 'wanker', 'wetback', 'whore',
];

const WORDS = new Set(OBJECTIONABLE_WORDS);

/** Whether text holds a listed word, splitting on anything that isn't a letter, as the database does. */
export function isObjectionable(text: string | null | undefined): boolean {
  return (text ?? '').toLowerCase().split(/[^a-z]+/).some((word) => WORDS.has(word));
}

/** Shown when a username or note has a listed word (the database says `text_objectionable`). */
export const OBJECTIONABLE_MESSAGE = 'Please choose different words. That one isn’t allowed on Kept.';

/** Why someone can report, in the order the report screen lists them. `value` is what the database stores. */
export const REPORT_REASONS = [
  { value: 'nudity', label: 'Nudity or sexual content' },
  { value: 'intimate_image', label: 'An intimate image shared without consent' },
  { value: 'harassment', label: 'Bullying or harassment' },
  { value: 'hate', label: 'Hate speech or symbols' },
  { value: 'spam', label: 'Spam or a fake account' },
  { value: 'other', label: 'Something else' },
] as const;

/** A plain sentence for a refused report, block or filtered text (never the raw database error). */
export function moderationErrorMessage(error: { code?: string; message?: string }): string {
  const message = error.message ?? '';
  if (message.includes('text_objectionable')) return OBJECTIONABLE_MESSAGE;
  if (message.includes('report_self')) return 'You can’t report yourself.';
  if (message.includes('report_rate_limited')) return 'That’s a lot of reports in an hour. Try again later, or email hello@habitkept.com.';
  if (message.includes('block_self')) return 'You can’t block yourself.';
  if (message.includes('report_no_target') || message.includes('block_no_challenge')) return 'That’s no longer on Kept.';
  if (!error.code) return 'Couldn’t reach Kept. Check your connection and try again.';
  return 'Kept couldn’t do that. Please try again.';
}
