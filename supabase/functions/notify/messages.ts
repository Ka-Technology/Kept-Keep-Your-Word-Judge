// What each push says and who it goes to (SPEC-notifications.md), kept apart from the Edge Function
// so the app's jest tests it (messages.test.ts). Deno and jest both load it, so it imports only
// _shared/, like ai-check/rules.ts.

import { localMinutes } from '../_shared/quiz.ts';

/** A message for Expo's push API (https://exp.host/--/api/v2/push/send), without its `to`. */
export type Push = {
  title: string;
  body: string;
  data?: { url: string };
  /** 'default' plays the phone's sound; left out, the push is silent. */
  sound?: 'default';
};

/** Expo's answer for one message. */
export type Ticket = { status: 'ok' | 'error'; details?: { error?: string } };

/** The app's language names (src/lib/challenges.ts LANGUAGES; the test keeps them the same). */
export const LANGUAGE_NAMES: Record<string, string> = {
  spanish: 'Spanish',
  french: 'French',
  german: 'German',
  italian: 'Italian',
  portuguese: 'Portuguese',
  japanese: 'Japanese',
  korean: 'Korean',
  mandarin: 'Mandarin Chinese',
};

/**
 * Whether friends can still review: before the challenger's step-in time in the challenge's zone (10 pm
 * unless they chose later, `fromMinutes`), when the AI takes waiting check-ins (SPEC-verification.md decision
 * 4; plan.md decision 180). It's the choice itself, not the quiz's opening, which is never later than 11 pm.
 */
export function beforeReviewCutoff(timeZone: string, now: Date, fromMinutes = 22 * 60): boolean {
  return localMinutes(now, timeZone) < fromMinutes;
}

/** The habit as a push names it: "Walk or run", or "Learn Korean". */
export function habitLabel(habitName: string, language: string | null): string {
  return language ? `Learn ${LANGUAGE_NAMES[language] ?? language}` : habitName;
}

/** "Check-ins to review" (section 1): a check-in, or its new photo after a friend's flag, waits for friends. */
export function reviewPush(c: { username: string; habit: string; day: number; checkInId: string; newPhoto: boolean }): Push {
  return {
    title: c.newPhoto ? `@${c.username} sent a new photo` : `@${c.username} checked in`,
    body: `Day ${c.day} of ${c.habit}. Can you approve it${c.newPhoto ? ' now' : ''}?`,
    data: { url: `/review/${c.checkInId}` },
    sound: 'default',
  };
}

/**
 * "Your check-ins" (section 2): the challenger's check-in needs a new photo, or wasn't approved. The
 * friend's note and the AI's reason stay off the lock screen; the check-in shows them. A rejection
 * often lands after midnight with nothing due, so it's silent.
 */
export function resultPush(c: {
  status: 'flagged' | 'retake' | 'rejected' | 'approved' | 'excused';
  /** The friend who flagged it; null for the AI's decisions, or if their username can't be read. */
  reviewer: string | null;
  habit: string;
  day: number;
  challengeId: string;
  /** False when no AI was involved: the challenger chose Don't allow and no friend approved (T54). */
  byAI?: boolean;
  /** What the AI answered, for an approval: retake or unsure means it counted the day on doubt. */
  verdict?: string | null;
}): Push {
  const data = { url: `/check-in/${c.challengeId}?day=${c.day}` };
  // The AI's own decisions on a day (2026-11-03): silent, nothing is due.
  if (c.status === 'approved') {
    if (c.verdict === 'retake' || c.verdict === 'unsure') {
      return { title: `Day ${c.day} counts`, body: `Kept’s AI couldn’t tell, so Day ${c.day} of ${c.habit} counts as kept.`, data };
    }
    return { title: `Day ${c.day} is kept`, body: `Kept’s AI approved Day ${c.day} of ${c.habit}.`, data };
  }
  if (c.status === 'excused') {
    return { title: `Day ${c.day} counts`, body: `Kept’s AI didn’t get to check Day ${c.day} of ${c.habit}, so it counts as kept.`, data };
  }
  if (c.status === 'flagged') {
    return { title: `${c.reviewer ? `@${c.reviewer}` : 'A friend'} asked for a new photo`, body: `Day ${c.day} of ${c.habit}. Send a new one before 10 pm.`, data, sound: 'default' };
  }
  if (c.status === 'retake') {
    return { title: 'Take a new photo', body: `Kept’s AI couldn’t confirm Day ${c.day} of ${c.habit}. Send a new one before midnight.`, data, sound: 'default' };
  }
  const why = c.byAI === false ? `No friend who backs you approved Day ${c.day} of ${c.habit} before it ended.` : `Kept’s AI didn’t approve Day ${c.day} of ${c.habit}.`;
  return { title: `Day ${c.day} wasn’t approved`, body: `${why} You can appeal within 7 days.`, data };
}

/** "Your check-ins": the quiz is open (Read, or Learn a language), at the user's step-in time. It makes a sound: the day is still open. */
export function quizOpenPush(c: { habit: string; day: number; challengeId: string }): Push {
  return {
    title: 'Your quiz is open',
    body: `Take Day ${c.day}’s quiz for ${c.habit} before midnight.`,
    data: { url: `/check-in/${c.challengeId}?day=${c.day}` },
    sound: 'default',
  };
}

/**
 * "Someone backs you" (section 3): a new pledge on your challenge, silent since nothing is due. A
 * backer is never named, not even by letter (SPEC-pledges.md decision 8); the username is ignored.
 */
export function pledgePush(p: { kind: 'supporter' | 'backer'; username: string | null; habit: string; challengeId: string }): Push {
  const data = { url: `/challenge/${p.challengeId}` };
  if (p.kind === 'supporter') {
    return { title: `${p.username ? `@${p.username}` : 'A friend'} backed you`, body: `They pledged behind ${p.habit}.`, data };
  }
  return { title: 'Someone backed you', body: `They found ${p.habit} on Discover and pledged behind it.`, data };
}

/**
 * "Payment received" (T169): the challenger's wallet payment for a Solana stake was found on chain. Sent to
 * every phone of theirs with a sound, because they've usually switched to their wallet app: tapping it opens
 * the challenge. The amount is the stake, not the fee on top, and only they ever get it.
 */
export function paymentPush(p: { token: string; stakeCents: number; habit: string; challengeId: string }): Push {
  return {
    title: 'Payment received',
    body: `Your ${dollars(p.stakeCents)} ${p.token} stake for ${p.habit} is in. Tap to open Kept.`,
    data: { url: `/challenge/${p.challengeId}` },
    sound: 'default',
  };
}

/**
 * "Results" (T177): a challenge ended, finished or not. The challenger hears how and opens their results, with a
 * sound on a finish; each pledger opens their pledge, a supporter told by name, a backer never (SPEC-pledges.md
 * decision 8). A cancel says nothing: whoever cancelled already knows.
 */
export function resultsPush(r: {
  role: 'challenger' | 'supporter' | 'backer';
  finished: boolean;
  habit: string;
  challengeId: string;
  stakeCents: number;
  charity: string;
  username: string | null;
}): Push {
  if (r.role === 'challenger') {
    const stake = dollars(r.stakeCents);
    return r.finished
      ? { title: 'You kept it', body: `${r.habit} is done, and your ${stake} stake comes back. See your results.`, data: { url: `/challenge/${r.challengeId}/results` }, sound: 'default' }
      : { title: 'Not this time', body: `${r.habit} ended, and your ${stake} stake goes to ${r.charity}. See your results.`, data: { url: `/challenge/${r.challengeId}/results` } };
  }
  const who = r.role === 'supporter' && r.username ? `@${r.username}` : null;
  const title = r.finished ? (who ? `${who} kept it` : 'A challenge you backed finished') : who ? `${who}’s challenge ended` : 'A challenge you backed ended';
  return { title, body: `${r.habit} ${r.finished ? 'is done' : 'wasn’t finished'}. See where your pledge went.`, data: { url: `/pledge/${r.challengeId}` } };
}

/** Days a return waits before it goes back to its card on its own, and the day it's reminded (migrations 0067, 0069). */
export const SEND_BACK_DAYS = 14;
export const MONEY_REMINDER_DAY = 10;

const dollars = (cents: number) => `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;

/**
 * The money pushes (T199, decision 160), to every phone of the person whose money it is: their reward landed in
 * Kept balance, money waits for their choice (when the challenge ends, and on day 10), a return went back to its
 * card, or a pledge in their reward was taken back by its bank. Nothing for a payment going through: they're in
 * the app then. Only the reward plays a sound; the rest is for when they next look.
 */
export function moneyPush(p: { kind: 'reward' | 'waiting' | 'reminder' | 'sent_back' | 'takeback'; cents: number; habit: string; challengeId: string | null }): Push {
  const amount = dollars(p.cents);
  const wallet = { url: '/wallet' };
  if (p.kind === 'reward') {
    return {
      title: 'Your reward is in',
      body: `${amount} for finishing ${p.habit} is in your Kept balance.`,
      data: p.challengeId ? { url: `/challenge/${p.challengeId}/results` } : wallet,
      sound: 'default',
    };
  }
  if (p.kind === 'waiting') return { title: 'Money is waiting', body: `Your ${amount} from ${p.habit}: keep it in Kept or send it back to your card.`, data: wallet };
  if (p.kind === 'reminder') {
    const days = SEND_BACK_DAYS - MONEY_REMINDER_DAY;
    return { title: 'Money is waiting', body: `Your ${amount} from ${p.habit} goes back to your card in ${days} days, unless you keep it in Kept.`, data: wallet };
  }
  if (p.kind === 'sent_back') {
    return { title: 'Sent back to your card', body: `Your ${amount} from ${p.habit} is on its way to your card. Banks can take 5 to 10 days to show it.`, data: wallet };
  }
  return { title: 'A pledge was taken back', body: `Its bank took back a ${amount} pledge on ${p.habit}, so it came out of your Kept balance.`, data: wallet };
}

/** "Friend requests" (section 4): someone asked to be your friend. */
export function friendRequestPush(username: string): Push {
  return {
    title: `@${username} sent you a friend request`,
    body: 'Accept it in Friends to see each other’s challenges.',
    data: { url: '/friends' },
    sound: 'default',
  };
}

/** A report's reason as the owner's push names it (the reasons in migration 0035). */
const REPORT_WORDS: Record<string, string> = {
  nudity: 'nudity or sexual content',
  intimate_image: 'an intimate image',
  harassment: 'bullying or harassment',
  hate: 'hate speech or symbols',
  spam: 'spam or a fake account',
  other: 'something else',
};

/**
 * A new report, to the owner (T53), so it's seen the same day: an intimate image shared without
 * consent must come down within 48 hours (the TAKE IT DOWN Act). Only the reason and what kind of
 * thing was reported: the note and every name stay in the dashboard.
 */
export function reportPush(r: { reason: string; what: 'person' | 'check-in' | 'challenge' }): Push {
  const what = `A ${r.what} was reported.`;
  return {
    title: `New report: ${REPORT_WORDS[r.reason] ?? r.reason}`,
    body:
      r.reason === 'intimate_image'
        ? `${what} Remove it within 48 hours if it breaks the rules (Supabase dashboard → reports).`
        : `${what} Review it in the Supabase dashboard → reports.`,
    sound: 'default',
  };
}

/** Feedback's kinds as the owner's push and email name them (the kinds in migration 0053). */
const FEEDBACK_WORDS: Record<string, string> = {
  bug: 'a bug',
  idea: 'an idea',
  habit: 'a habit to add',
  other: 'something else',
};

/** Where feedback is emailed: the address the app shows (OPERATOR.email; the test keeps them the same). */
export const FEEDBACK_TO = 'hello@habitkept.com';

/** New feedback, to the owner (T158). Only its kind: the message and the sender's name are in the email. */
export function feedbackPush(kind: string): Push {
  return { title: `New feedback: ${FEEDBACK_WORDS[kind] ?? kind}`, body: 'Read it in your email or the Supabase dashboard → feedback.' };
}

/**
 * The owner's email for new feedback (T158), for Resend's API: plain text only, so nothing the
 * sender wrote can render as HTML. Replying answers the sender, when their account still exists.
 */
export function feedbackEmail(f: {
  kind: string;
  message: string;
  /** Null once the sender's account is deleted. */
  username: string | null;
  replyTo: string | null;
  appVersion: string | null;
  os: string | null;
  osVersion: string | null;
  /** A signed link to the photo, or null without one. */
  photoUrl: string | null;
}): { from: string; to: string; reply_to?: string; subject: string; text: string } {
  const from = f.username ? `@${f.username}` : 'a deleted account';
  const lines = [
    f.message,
    '',
    '—',
    `From ${from}${f.replyTo ? ` (${f.replyTo}). Reply to this email to answer them.` : '.'}`,
    `Kept ${f.appVersion ?? '?'} on ${f.os ?? '?'} ${f.osVersion ?? '?'}`,
    ...(f.photoUrl ? [`Photo (link works for 7 days): ${f.photoUrl}`] : []),
    'Mark it handled in the Supabase dashboard → feedback.',
  ];
  return {
    from: 'Kept <no-reply@habitkept.com>',
    to: FEEDBACK_TO,
    ...(f.replyTo ? { reply_to: f.replyTo } : {}),
    subject: `Kept feedback: ${FEEDBACK_WORDS[f.kind] ?? f.kind} from ${from}`,
    text: lines.join('\n'),
  };
}

/** One message per token, in requests of at most 100 (Expo's limit). */
export function batches(tokens: string[], push: Push): ({ to: string } & Push)[][] {
  const out: ({ to: string } & Push)[][] = [];
  for (let i = 0; i < tokens.length; i += 100) out.push(tokens.slice(i, i + 100).map((to) => ({ to, ...push })));
  return out;
}

/** The tokens Expo reports gone (the app was deleted or notifications revoked). Tickets come in message order. */
export function goneTokens(messages: { to: string }[], tickets: Ticket[]): string[] {
  return messages.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered').map((m) => m.to);
}
