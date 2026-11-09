// The create-a-challenge rules on the app side (SPEC-challenges.md). These mirror the checks in
// supabase/migrations/0004_challenges.sql (and 0005 for the length) exactly, in the same order, so the form catches a problem
// before anything is sent and the database refuses the same things if it's ever bypassed.
// Pure: no React or Supabase imports (tested in challenges.test.ts).

import { calendarDate, challengeDay, chargeFor, completionRate, feeBreakdown, MAX_BOUGHT_SHIELDS, pledgeDonated, pledgeRewards, progress, settle, shieldPriceCents, shieldSplit, SHIELDS, type CheckInStatus, type Ending } from './challenge-rules';
import { decidedByAI, evidenceFor, reviewedStatusText } from './check-in';
import type { ChallengePledge } from './pledges';

/** How long a challenge can be, in completed days (`length_days`). 28 is also the starting value. */
export const LENGTH_LIMITS = { minDays: 28, maxDays: 365 };

/** The habit step's headings, in order (A3, T109). */
export const HABIT_GROUPS = ['Mind', 'Body', 'Food', 'Calm', 'Making'] as const;

/**
 * Which heading a habit sits under, from its place in Kept's list: the habits table is numbered in
 * groups (migration 0043: mind 1–6, body 7–11, food 12–13, calm 14–15, making 16 on).
 */
export function habitGroup(position: number): (typeof HABIT_GROUPS)[number] {
  return position <= 6 ? 'Mind' : position <= 11 ? 'Body' : position <= 13 ? 'Food' : position <= 15 ? 'Calm' : 'Making';
}

/**
 * Learn a language's languages; the codes are what the `language` column takes, and `speech` is the
 * voice (BCP 47) that reads a quiz's listening question aloud (T42).
 */
export const LANGUAGES = [
  { code: 'spanish', name: 'Spanish', speech: 'es-ES' },
  { code: 'french', name: 'French', speech: 'fr-FR' },
  { code: 'german', name: 'German', speech: 'de-DE' },
  { code: 'italian', name: 'Italian', speech: 'it-IT' },
  { code: 'portuguese', name: 'Portuguese', speech: 'pt-BR' },
  { code: 'japanese', name: 'Japanese', speech: 'ja-JP' },
  { code: 'korean', name: 'Korean', speech: 'ko-KR' },
  { code: 'mandarin', name: 'Mandarin Chinese', speech: 'zh-CN' },
] as const;

/** The voice for a language code, or undefined for none. */
export function speechLanguage(code: string | null | undefined): string | undefined {
  return LANGUAGES.find((l) => l.code === code)?.speech;
}

/** Learn a language's levels (`level`). */
export const LEVELS = [
  { code: 'beginner', name: 'Beginner' },
  { code: 'intermediate', name: 'Intermediate' },
  { code: 'advanced', name: 'Advanced' },
] as const;

/** Ways to pay (`payment_method`). Recorded only in the demo: nothing is charged. */
export const PAYMENT_METHODS = [
  { code: 'card', name: 'Card' },
  { code: 'solana_usdc', name: 'Solana (USDC)' },
] as const;

/**
 * The dollar stablecoins a Solana stake can be paid in (`pay_token`, migration 0055; owner, 2026-10-26).
 * solana-pay's TOKENS has each one's mint, tested against this list.
 */
export const SOLANA_TOKENS = ['USDC', 'USDT', 'PYUSD'] as const;

/**
 * Whether Solana stakes are really collected from a wallet (T169), on the cluster the flag names: only
 * builds with EXPO_PUBLIC_SOLANA_PAY set ("devnet" while testing). Without it, Solana stays pretend.
 */
export function solanaPayEnabled(flag: string | undefined = process.env.EXPO_PUBLIC_SOLANA_PAY): boolean {
  return !!flag;
}

/**
 * The token the stake step picks first: on devnet, Kept's own test USDT, which Kept tops up when the wallet is
 * short so a tester needs no faucet (T222); otherwise USDC.
 */
export function defaultSolanaToken(cluster: string | undefined = process.env.EXPO_PUBLIC_SOLANA_PAY): (typeof SOLANA_TOKENS)[number] {
  return cluster === 'devnet' ? 'USDT' : SOLANA_TOKENS[0];
}

/** The Solana Pay link that opens the user's wallet on this challenge's payment (a transaction request). */
export function solanaPayLink(
  id: string,
  supabaseUrl: string | undefined = process.env.EXPO_PUBLIC_SUPABASE_URL,
  /** A stake's payment is found by its challenge; a crypto pledge's by its own id (T171). */
  by: 'challenge' | 'payment' = 'challenge',
): string {
  return `solana:${encodeURIComponent(`${supabaseUrl}/functions/v1/solana-pay?${by}=${id}`)}`;
}

/** The way to pay in words: "Card", or "Solana (PYUSD)" with the token picked. */
export function paymentNameFor(method: string | null | undefined, token?: string | null): string {
  // Kept balance (decision 150) is a choice on the stake step; the challenge records it as a card one with `use_balance`.
  if (method === 'balance') return 'Kept balance';
  return method === 'solana_usdc' && token ? `Solana (${token})` : nameFor(PAYMENT_METHODS, method);
}

/**
 * The stake limits from SPEC.md, in whole dollars: at least $10 with no maximum per challenge
 * (owner, 2026-09-25), up to $25 on a first challenge, and $300 in total across unended ones.
 */
export const STAKE_LIMITS = { minDollars: 10, firstChallengeMaxDollars: 25, outstandingMaxDollars: 300 };

/** A whole number typed in a box (surrounding spaces are fine), or null if it isn't one. */
export function parseWholeNumber(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** Whole dollars typed in the stake box (a leading $ is fine), or null if it isn't a whole number. */
export function parseStakeDollars(text: string): number | null {
  return parseWholeNumber(text.trim().replace(/^\$/, ''));
}

/** Why a length can't be used, or null if it can (mirrors the `length_days` check). */
export function lengthError(days: number | null): string | null {
  const { minDays, maxDays } = LENGTH_LIMITS;
  if (days === null) return `Enter a number of days, like ${minDays}.`;
  if (days < minDays) return `A challenge is at least ${minDays} completed days.`;
  if (days > maxDays) return `A challenge can be up to ${maxDays} completed days.`;
  return null;
}

/** A length in weeks, under How many days' big number (T213): "4 weeks", "12 weeks and 6 days". */
export function weeksLabel(days: number): string {
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  const parts = [weeks ? `${weeks} week${weeks === 1 ? '' : 's'}` : null, rest ? `${rest} day${rest === 1 ? '' : 's'}` : null];
  return parts.filter(Boolean).join(' and ');
}

/**
 * A challenge being set up, carried from step to step of Start a challenge as route parameters
 * (all strings). Each step adds its part; the sign step has everything.
 */
export type ChallengeDraft = {
  habitId: string;
  habitName: string;
  /** Learn a language only: LANGUAGES and LEVELS codes. */
  language?: string;
  level?: string;
  days: string;
  stake: string;
  payment: string;
  /** A SOLANA_TOKENS code, when Solana stakes are collected (solanaPayEnabled). */
  token?: string;
  charityId: string;
  charityName: string;
};

/**
 * What the Stake step needs to start this challenge again with another way to pay (T93, T169): the habit and length
 * stay, and the stake, charity and signature are asked again, since the unpaid one was removed.
 */
export function restartDraft(c: Pick<ChallengeSummary, 'habitId' | 'title' | 'language' | 'level' | 'lengthDays'>): Partial<ChallengeDraft> {
  return { habitId: c.habitId, habitName: c.title, days: String(c.lengthDays), ...(c.language && { language: c.language }), ...(c.level && { level: c.level }) };
}

/** The display name for a LANGUAGES, LEVELS or PAYMENT_METHODS code. */
export function nameFor(list: readonly { code: string; name: string }[], code: string | null | undefined): string {
  return list.find((item) => item.code === code)?.name ?? code ?? '';
}

/**
 * Why this habit can't start a new challenge, or null if it can: only one challenge per habit may
 * run at a time, and for Learn a language one per language (any level). `running` is the user's
 * challenges without a recorded outcome. Mirrors the insert trigger (migration 0007).
 */
export function duplicateChallengeError(
  habitId: string,
  language: string | null,
  habitName: string,
  running: { habit_id: string; language: string | null }[],
): string | null {
  if (habitId === 'language' && !language) return null;
  const clash = running.some((c) => c.habit_id === habitId && (c.language ?? null) === (language ?? null));
  if (!clash) return null;
  const what = language ? nameFor(LANGUAGES, language) : `“${habitName}”`;
  return `You already have a ${what} challenge running. Finish it before starting another.`;
}

/** What the limits depend on: whether this is the user's first challenge, and what's staked on unended ones. */
export type StakeContext = { isFirst: boolean; outstandingCents: number };

/** Works out the StakeContext from the user's challenges (any outcome counts towards "not first"). */
export function stakeContext(challenges: { stake_cents: number; outcome: string | null }[]): StakeContext {
  return {
    isFirst: challenges.length === 0,
    outstandingCents: challenges.filter((c) => c.outcome === null).reduce((sum, c) => sum + c.stake_cents, 0),
  };
}

/**
 * Why a stake can't be used, or null if it can. Checked in the insert trigger's order: the $10
 * minimum, then the first-challenge cap, then the $300 total.
 */
export function stakeError(dollars: number | null, { isFirst, outstandingCents }: StakeContext): string | null {
  const { minDollars, firstChallengeMaxDollars, outstandingMaxDollars } = STAKE_LIMITS;
  if (dollars === null) return 'Enter a stake in whole dollars, like 25.';
  if (dollars < minDollars) return `The smallest stake is $${minDollars}.`;
  if (isFirst && dollars > firstChallengeMaxDollars) {
    return `Your first challenge can have a stake of up to $${firstChallengeMaxDollars}.`;
  }
  const outstanding = outstandingCents / 100;
  if (outstanding + dollars > outstandingMaxDollars) {
    const left = outstandingMaxDollars - outstanding;
    const staked = `You have $${outstanding} staked on challenges that haven’t ended, and the total can be up to $${outstandingMaxDollars}.`;
    return left < minDollars ? `${staked} Finish one before starting another.` : `${staked} You can stake up to $${left} now.`;
  }
  return null;
}

/** The phone's IANA time zone (e.g. America/Los_Angeles); a new challenge keeps it for good. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Day 1 of a challenge created at `now`: the next calendar day in `timeZone`, as YYYY-MM-DD.
 * The insert trigger sets `start_date` the same way; this is for showing "Starts tomorrow, …".
 */
export function startDate(timeZone: string, now: Date): string {
  // Adding a day in UTC to that calendar date is safe across daylight-saving changes.
  return new Date(Date.parse(`${calendarDate(timeZone, now)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** A plain sentence for a failed challenge insert (never the raw database error). */
export function challengeErrorMessage(error: { code?: string; message?: string }): string {
  const message = error.message ?? '';
  if (message.includes('first_challenge_stake_limit')) {
    return `Your first challenge can have a stake of up to $${STAKE_LIMITS.firstChallengeMaxDollars}.`;
  }
  if (message.includes('outstanding_stake_limit')) {
    return `Stakes on your challenges that haven’t ended can be up to $${STAKE_LIMITS.outstandingMaxDollars} in total.`;
  }
  if (message.includes('duplicate_challenge')) {
    return 'You already have a challenge for this habit running. Finish it before starting another.';
  }
  if (message.includes('stake_minimum')) return `The smallest stake is $${STAKE_LIMITS.minDollars}.`;
  if (message.includes('name_required')) return 'Add your first and last name in Personal info, then sign.';
  if (message.includes('challenges_stake_cents_check')) return 'Stakes are whole dollars.';
  if (!error.code) return 'Couldn’t reach Kept. Check your connection and try again.';
  return 'Kept couldn’t start this challenge. Please try again.';
}

/**
 * The promise on the review screen, in the challenger's own words, one paragraph per item: who
 * (their full name, since it's signed: decision 171), what they commit to and when, the shields, where
 * the stake goes either way, who can back it (friends only, or backers too when it's public:
 * SPEC-pledges.md), and the fee. The habit is quoted by name ("Stretch or yoga" doesn't read as a verb).
 */
export function contractText({
  fullName,
  habitName,
  language,
  level,
  startsOn,
  lengthDays,
  stakeDollars,
  paymentName,
  charityName,
  isPublic,
  aiChecks = true,
}: {
  /** "First Last" (`fullName()` in profile.ts). */
  fullName: string;
  habitName: string;
  /** Learn a language only: the language's and level's display names. */
  language?: string;
  level?: string;
  /** Day 1, already formatted, e.g. "Saturday, September 26". */
  startsOn: string;
  lengthDays: number;
  stakeDollars: number;
  paymentName: string;
  charityName: string;
  /** Whether backers who aren't friends can find it under Discover (`is_public`). */
  isPublic: boolean;
  /** False after the challenger chose Don't allow for Kept's AI (T54): only friends check the days. */
  aiChecks?: boolean;
}): string[] {
  const languagePart = language && level ? ` (${language}, ${level.toLowerCase()})` : '';
  const payment = paymentName === 'Card' ? 'card' : paymentName;
  const { feeCents, totalCents } = feeBreakdown(stakeDollars * 100);
  const checkers = aiChecks ? 'check my days, along with Kept’s AI.' : 'check my days, and a day none of them approves by midnight counts as missed.';
  return [
    `I, ${fullName}, commit to “${habitName}”${languagePart} every day, starting tomorrow, ${startsOn}, until I’ve completed ${lengthDays} days.`,
    `Each missed day breaks one of my ${SHIELDS} shields and adds a day to the end. A miss with no shield left ends the challenge.`,
    `I’m staking $${stakeDollars} by ${payment}. If I finish, my $${stakeDollars} comes back to me. If I don’t, it goes to ${charityName}.`,
    isPublic
      ? 'Backers who aren’t my friends can find this challenge under Discover and back it. They see only its progress (the habit, the day, my shields and the charity), never my username or photo. Only friends who back me ' + checkers
      : 'Only my friends can back this challenge. Friends who back it ' + checkers,
    `On top of my $${stakeDollars} stake, Kept’s service fee is ${dollarsAndCents(feeCents)}, so I’d pay ${dollarsAndCents(totalCents)} in all. The fee is non-refundable once I sign.`,
  ];
}

/** A plain sentence for a failed check-in (never the raw database error). */
export function checkInErrorMessage(error: { code?: string; message?: string }): string {
  if (error.code === '23505') return 'You’ve already checked in today.';
  const message = error.message ?? '';
  if (message.includes('check_in_not_today')) return 'You can only check in for today, on a challenge that’s still running.';
  if (message.includes('ai_choice_needed')) return 'Choose whether Kept’s AI may check your days first.';
  if (message.includes('check_in_photo_required')) return 'This habit checks in with a photo.';
  if (message.includes('check_in_read_details')) return 'Enter the book and the pages you read.';
  if (!error.code) return 'Couldn’t reach Kept. Check your connection and try again.';
  return 'Kept couldn’t check you in. Please try again.';
}

/** A challenge as the app reads it, with its habit's and charity's names and its check-ins. */
export type ChallengeRow = {
  id: string;
  habit_id: string;
  language: string | null;
  level: string | null;
  length_days: number;
  stake_cents: number;
  start_date: string;
  time_zone: string;
  day_offset: number;
  outcome: Ending | null;
  ended_on_day: number | null;
  payment_method: string;
  /** The stablecoin a collected Solana stake is paid in (migration 0055), and whether it's arrived. */
  pay_token?: string | null;
  payment_status?: 'awaiting' | 'paid' | null;
  /** Backers who aren't friends can find it under Discover (SPEC-pledges.md decision 6). */
  is_public: boolean;
  habits: { name: string } | null;
  charities: { name: string; slug?: string | null } | null;
  check_ins: { day: number; status: CheckInStatus; reviewed_at?: string | null; ai_checked_at?: string | null }[];
  /** Revival shields bought (migration 0039): the missed day each covers, and its price. */
  shield_purchases?: { day: number; price_cents: number }[];
};

/** The columns (and joined names) that make a ChallengeRow, for Supabase `select()`. */
export const CHALLENGE_COLUMNS =
  'id, habit_id, language, level, length_days, stake_cents, start_date, time_zone, day_offset, outcome, ended_on_day, payment_method, pay_token, payment_status, is_public, habits(name), charities(name, slug), check_ins(day, status, reviewed_at, ai_checked_at), shield_purchases(day, price_cents)';

/** Where a challenge is: not started yet, running, or ended one way or another (T52 adds cancelled). */
export type ChallengeState = 'upcoming' | 'active' | Ending;

/** What the screens show for a challenge. Every number comes from challenge-rules.ts. */
export type ChallengeSummary = {
  id: string;
  /** The habit's id on Kept's list ('read', 'walk-run', …), for its icon and its check. */
  habitId: string;
  /** The habit, with the language and level for Learn a language. */
  title: string;
  /** Learn a language only: LANGUAGES and LEVELS codes. */
  language?: string | null;
  level?: string | null;
  charityName: string;
  /** The charity's Every.org page name, for its "learn more" link (null: none). */
  charitySlug?: string | null;
  stakeDollars: number;
  paymentName: string;
  /** Signed with a wallet or card that hasn't paid yet: it waits for the payment (T169, T93). */
  awaitingPayment?: boolean;
  /** Waiting for a card payment (T93), not a wallet's. */
  awaitingCard?: boolean;
  /** Its stake and fee arrived from the wallet, up front (T169). */
  paidUpFront?: boolean;
  /** The token a crypto challenge was paid in, which its crypto pledges are paid in too (T171); null otherwise. */
  payToken?: string | null;
  /** Open to backers under Discover. */
  isPublic: boolean;
  lengthDays: number;
  startDate: string;
  /** The zone the challenge's days run in; its deadline is midnight there. */
  timeZone: string;
  /** Today's day number (0 before Day 1). */
  today: number;
  daysCompleted: number;
  daysRequired: number;
  shieldsLeft: number;
  /** Shields in all: SHIELDS plus any bought. */
  shieldsTotal: number;
  /** Each missed day, in order, with the price of the shield bought for it (null: a shield it started with broke). */
  missedDays: { day: number; boughtCents: number | null }[];
  /** How many revival shields were bought. */
  boughtShields: number;
  /**
   * The next revival shield, while it can be bought: the misses ended it, today is the day after the
   * ending miss, and fewer than 3 were bought (buy_shield(), migration 0039). Null otherwise.
   */
  revival: { priceCents: number; charityCents: number; keptCents: number } | null;
  /** A finish waits until its days are decided: the server records it then (0039). */
  underReview: boolean;
  state: ChallengeState;
  endedOnDay: number | null;
  /** Ended by the challenger quitting (from Day 2), not by its misses. */
  quit: boolean;
  /** Whether today already has a check-in. */
  checkedInToday: boolean;
  /** Today's check-in status in words (SPEC-verification.md), or null before checking in. */
  todayText: string | null;
  /** Each checked-in day, in day order, with its status in words ("Approved by Kept’s AI"): see stampDays. */
  days: { day: number; status: CheckInStatus; text: string }[];
};

/**
 * Turns a challenge row into what the screens show, at `now`. A recorded outcome is final; an
 * ending the rules see but the app hasn't recorded yet (T20) shows as ended too.
 */
export function summarizeChallenge(row: ChallengeRow, now: Date): ChallengeSummary {
  const today = challengeDay(row.start_date, row.time_zone, row.day_offset, now);
  const bought = row.shield_purchases ?? [];
  const shieldsTotal = SHIELDS + bought.length;
  const rules = (day: number) => progress({ lengthDays: row.length_days, stakeCents: row.stake_cents, checkIns: row.check_ins, shields: shieldsTotal }, day);
  let result = rules(today);
  // A cancel or a quit ended it on a day of its own: what the rules would say after that day doesn't
  // count, so its misses, shields and length stop there (review, 2026-10-04).
  const quit = row.outcome === 'not_finished' && row.ended_on_day !== null && result.endedOnDay !== row.ended_on_day;
  const stoppedEarly = row.outcome === 'cancelled' || quit;
  const lastToday = stoppedEarly && row.ended_on_day !== null ? Math.min(today, row.ended_on_day) : today;
  if (lastToday !== today) result = rules(lastToday);
  const habit = row.habits?.name ?? row.habit_id;
  const inWords = (c: ChallengeRow['check_ins'][number]) => reviewedStatusText(c.status, null, decidedByAI(c), evidenceFor(row.habit_id));
  const todayCheckIn = row.check_ins.find((c) => c.day === today);
  const state: ChallengeState = row.outcome ?? (result.outcome !== 'active' ? result.outcome : today === 0 ? 'upcoming' : 'active');
  const endedOnDay = row.ended_on_day ?? result.endedOnDay;
  // Missed days: ended days without a done status, up to where it ended.
  const statusOn = new Map(row.check_ins.map((c) => [c.day, c.status]));
  const lastDay = Math.min(lastToday - 1, endedOnDay ?? Infinity);
  const missedDays = Array.from({ length: Math.max(0, lastDay) }, (_, i) => i + 1)
    .filter((day) => [undefined, 'rejected', 'appealed'].includes(statusOn.get(day)))
    .map((day) => ({ day, boughtCents: bought.find((b) => b.day === day)?.price_cents ?? null }));
  // The misses ended it (not a quit), yesterday, with shields still to buy.
  const revivable =
    state === 'not_finished' &&
    result.outcome === 'not_finished' &&
    result.endedOnDay !== null &&
    endedOnDay === result.endedOnDay &&
    today === result.endedOnDay + 1 &&
    bought.length < MAX_BOUGHT_SHIELDS;
  const price = revivable ? shieldPriceCents(row.stake_cents, bought.length + 1) : 0;
  return {
    id: row.id,
    language: row.language,
    level: row.level,
    habitId: row.habit_id,
    title: row.language ? `${habit}: ${nameFor(LANGUAGES, row.language)}, ${nameFor(LEVELS, row.level).toLowerCase()}` : habit,
    charityName: row.charities?.name ?? '',
    charitySlug: row.charities?.slug ?? null,
    stakeDollars: row.stake_cents / 100,
    paymentName: paymentNameFor(row.payment_method, row.pay_token),
    awaitingPayment: row.payment_status === 'awaiting',
    awaitingCard: row.payment_status === 'awaiting' && row.payment_method === 'card',
    paidUpFront: row.payment_status === 'paid',
    payToken: row.pay_token ?? null,
    isPublic: row.is_public,
    lengthDays: row.length_days,
    startDate: row.start_date,
    timeZone: row.time_zone,
    today,
    daysCompleted: result.daysCompleted,
    daysRequired: result.daysRequired,
    shieldsLeft: result.shieldsLeft,
    shieldsTotal,
    missedDays,
    boughtShields: bought.length,
    revival: revivable ? { priceCents: price, ...shieldSplit(price) } : null,
    underReview: result.underReview,
    state,
    endedOnDay,
    quit,
    checkedInToday: !!todayCheckIn,
    todayText: todayCheckIn ? inWords(todayCheckIn) : null,
    days: [...row.check_ins].sort((a, b) => a.day - b.day).map((c) => ({ day: c.day, status: c.status, text: inWords(c) })),
  };
}

/** How a day looks on the stamp card: stamped kept, missed, still being checked, today, or still to come. */
export type StampKind = 'kept' | 'missed' | 'open' | 'redo' | 'today' | 'ahead';

// A friend or Kept's AI asked for a new check-in: it's to redo, in red, not just open (owner, 2026-10-02).
const STAMP: Partial<Record<CheckInStatus, StampKind>> = { approved: 'kept', excused: 'kept', rejected: 'missed', flagged: 'redo', retake: 'redo' };

/**
 * The challenge detail's stamp card: every day of the challenge, up to the days required (misses
 * add days) or to where it ended, each with its stamp and words for VoiceOver. A past day with no
 * check-in is a miss; a check-in still being checked (or appealed) stays open.
 */
export function stampDays(c: ChallengeSummary): { day: number; kind: StampKind; text: string }[] {
  const ended = c.state === 'finished' || c.state === 'not_finished' || c.state === 'cancelled';
  const last = ended ? (c.endedOnDay ?? c.daysRequired) : Math.max(c.daysRequired, c.today);
  const byDay = new Map(c.days.map((d) => [d.day, d]));
  return Array.from({ length: last }, (_, i) => {
    const day = i + 1;
    const checkIn = byDay.get(day);
    if (checkIn) return { day, kind: STAMP[checkIn.status] ?? 'open', text: checkIn.text };
    if (day < c.today || ended) return { day, kind: 'missed', text: 'No check-in' };
    if (day === c.today) return { day, kind: 'today', text: 'Not checked in yet' };
    return { day, kind: 'ahead', text: 'To come' };
  });
}

/** The weeks the stamp card shows at once: four rows, so a long challenge never makes the screen scroll far. */
export const STAMP_WINDOW_WEEKS = 4;

/**
 * Which days of a long challenge's stamp card show: four weeks, starting two weeks before today's, so today sits in
 * the third row, 60–70% down the board, and the days to come show below it. `startWeek` moves it by hand (the arrows),
 * kept inside the challenge. A challenge of four weeks or less shows every day.
 */
export function stampWindow(total: number, today: number, startWeek: number | null = null) {
  const weeks = Math.ceil(total / 7);
  const last = Math.max(0, weeks - STAMP_WINDOW_WEEKS);
  const start = Math.min(last, Math.max(0, startWeek ?? Math.floor((today - 1) / 7) - 2));
  return { from: start * 7 + 1, to: Math.min(total, (start + STAMP_WINDOW_WEEKS) * 7), startWeek: start, hasPrev: start > 0, hasNext: start < last };
}

/**
 * The update that records a challenge's ending (T20), or null if there's nothing to record: it's
 * still running, or its outcome is already recorded (and final). The app sends it the first time
 * it sees the rules end a challenge; `payments` moves this to the server.
 */
export function outcomeUpdate(row: ChallengeRow, now: Date): { outcome: 'finished' | 'not_finished' } | null {
  const c = summarizeChallenge(row, now);
  if (row.outcome || (c.state !== 'finished' && c.state !== 'not_finished')) return null;
  // The server records a finish only once its days are decided (0039); until then there's nothing to send.
  if (c.state === 'finished' && c.underReview) return null;
  // The database sets the day and time it ended (0039), from the check-ins, not from the app.
  return { outcome: c.state };
}

/** "$35.00": the results screen's lines, to the cent like a receipt. */
const dollarsAndCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** "$35" for whole dollars and "$2.50" otherwise: amounts in sentences and totals (Wallet, Home). */
export const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/**
 * An amount like "$35.00" or "$85" at `share` (0 to 1) of the way up from $0, in the same format,
 * for the results screen's count-up (T98). Anything that isn't an amount comes back as it is.
 */
export function amountAt(amount: string, share: number): string {
  const match = /^\$(\d+)(\.\d+)?$/.exec(amount);
  if (!match) return amount;
  const decimals = match[2] ? match[2].length - 1 : 0;
  const scale = 10 ** decimals;
  // Whole units (cents) first, so 0.29 × 100 lands on 29 and not 28.999….
  const units = Math.round(Number(amount.slice(1)) * scale);
  return `$${(Math.floor(units * Math.min(1, Math.max(0, share))) / scale).toFixed(decimals)}`;
}

/**
 * Where every (pretend) dollar of an ended challenge goes, as rows for the results screen, from
 * settle(): the stake back to the card or wallet, or to the charity; each pledge, to the challenger as
 * their reward, to the charity, or back to its pledger (supporters by name, backers by letter;
 * decision 143); the reward's total; extra gifts; the charity's total;
 * each backer's Kept credits (T45); then the example fee (T32). Empty while the challenge is running.
 */
export function settlementLines(
  c: ChallengeSummary,
  { pledges = [], giftsCents = 0 }: { pledges?: ChallengePledge[]; giftsCents?: number } = {},
): { label: string; value: string }[] {
  if (c.state === 'upcoming' || c.state === 'active') return [];
  const shieldsCents = c.missedDays.reduce((sum, d) => sum + (d.boughtCents ?? 0), 0);
  const s = settle({ lengthDays: c.lengthDays, stakeCents: c.stakeDollars * 100, checkIns: [] }, c.state, {
    pledges: pledges.map((p) => ({ kind: p.kind, amountCents: p.amount_cents, donateIfNotFinished: p.donate_if_not_finished, toCharityOnFinish: p.to_charity_on_finish })),
    extraGivingCents: giftsCents,
    shieldsCents,
  });
  const lines =
    c.state !== 'not_finished'
      ? [{ label: `Back to your ${c.paymentName === 'Card' ? 'card' : 'wallet'}`, value: dollarsAndCents(s.stakeToChallengerCents) }]
      : [{ label: `To ${c.charityName}`, value: dollarsAndCents(s.stakeToCharityCents) }];
  for (const p of pledges) {
    const choices = { donateIfNotFinished: p.donate_if_not_finished, toCharityOnFinish: p.to_charity_on_finish };
    const where = pledgeDonated(choices, c.state) ? `to ${c.charityName}` : pledgeRewards(choices, c.state) ? 'to you, your reward' : 'back to them';
    const who = p.username ?? p.backer ?? 'A backer';
    lines.push({ label: `${who}’s pledge, ${where}`, value: dollarsAndCents(p.amount_cents) });
  }
  if (s.pledgesToChallengerCents > 0) lines.push({ label: 'Your reward for finishing', value: dollarsAndCents(s.pledgesToChallengerCents) });
  if (giftsCents > 0) lines.push({ label: `Extra gifts, to ${c.charityName}`, value: dollarsAndCents(s.extraGivingToCharityCents) });
  if (shieldsCents > 0) {
    const n = c.boughtShields === 1 ? 'Bought shield' : `${c.boughtShields} bought shields`;
    lines.push({ label: `${n}, half to ${c.charityName}`, value: dollarsAndCents(s.shieldsToCharityCents) });
    lines.push({ label: `${n}, half to Kept`, value: dollarsAndCents(s.shieldsToKeptCents) });
  }
  if (pledges.length > 0 || giftsCents > 0 || shieldsCents > 0) lines.push({ label: `Total to ${c.charityName}`, value: dollarsAndCents(s.charityTotalCents) });
  pledges.forEach((p, i) => {
    if (s.creditsCents[i] > 0) lines.push({ label: `${p.backer ?? 'A backer'} earns Kept credits`, value: dollarsAndCents(s.creditsCents[i]) });
  });
  // A wallet stake is paid on Solana with its fee, so only the card's fee is an example.
  const fee = c.paymentName.startsWith('Solana')
    ? 'Service fee (paid, kept either way)'
    : c.state === 'cancelled' ? 'Service fee (example, not charged; non-refundable)' : 'Service fee (example, not charged)';
  lines.push({ label: fee, value: dollarsAndCents(s.serviceFeeCents) });
  return lines;
}

/**
 * What someone pays for a stake or pledge, listed to the cent before they confirm (T63; SPEC.md:
 * never hide a fee): the amount, any of it from Kept balance (T189), Kept's service fee on what the card
 * pays, any of the fee paid with Kept credits (T164), and the total. Balance and credits count only where a
 * card is charged for real; pass 0 otherwise.
 */
export function feeLines(what: 'Stake' | 'Pledge', amountCents: number, creditsLeftCents = 0, balanceLeftCents = 0): { label: string; value: string }[] {
  const c = chargeFor(amountCents, feeBreakdown(amountCents).feeCents, { creditsLeftCents, balanceLeftCents });
  return [
    { label: what, value: dollarsAndCents(amountCents) },
    ...(c.balanceCents > 0 ? [{ label: 'From your Kept balance', value: `−${dollarsAndCents(c.balanceCents)}` }] : []),
    { label: 'Kept’s service fee', value: dollarsAndCents(c.feeCents) },
    ...(c.creditsCents > 0 ? [{ label: 'Paid with Kept credits', value: `−${dollarsAndCents(c.creditsCents)}` }] : []),
    { label: 'Total', value: dollarsAndCents(c.totalCents) },
  ];
}

/** What raising a pledge adds: the extra and its fee, less any Kept balance (T189) and credits (T164). */
export function raiseText(currentCents: number, newCents: number, creditsLeftCents = 0, balanceLeftCents = 0): string {
  const [was, now] = [feeBreakdown(currentCents), feeBreakdown(newCents)];
  const c = chargeFor(newCents - currentCents, now.feeCents - was.feeCents, { creditsLeftCents, balanceLeftCents });
  const paidWith = [
    c.balanceCents > 0 ? `${dollarsAndCents(c.balanceCents)} of the pledge from your Kept balance` : null,
    c.creditsCents > 0 ? `${dollarsAndCents(c.creditsCents)} of the fee paid with Kept credits` : null,
  ].filter(Boolean);
  return (
    `You’ve paid ${dollarsAndCents(was.totalCents)}. Raising to ${money(newCents)} adds ${dollarsAndCents(c.totalCents)}: ` +
    `${dollarsAndCents(newCents - currentCents)} more pledged and ${dollarsAndCents(c.feeCents)} more fee` +
    (paidWith.length ? `, ${paidWith.join(' and ')}.` : '.')
  );
}

/**
 * The donation route (T61; SPEC-pledges.md, "The donation route"): how money reaches the charity once
 * `payments` exists, as rows for the results screen. Nothing is held or sent in the demo.
 */
export function donationRoute(charityName: string): { label: string; detail: string }[] {
  return [
    { label: 'While it runs', detail: 'Kept holds the stake and every pledge.' },
    { label: 'When it ends', detail: `Kept sends each donation to ${charityName} through its donation partner, with the giver’s name on it.` },
    { label: 'A finish', detail: 'The stake comes back, and each pledge goes to the challenger as their reward, unless its pledger chose the charity.' },
    { label: 'Everything else', detail: 'Goes back to the card or wallet it came from.' },
  ];
}

/**
 * What the challenger can do to end a running challenge early (T52; SPEC.md money rules): cancel
 * until the end of Day 1 (stake and pledges back, fee kept), then quit (counts as not finishing).
 * Null once it has ended. The database enforces the same days (migration 0026).
 */
export function cancelOrQuit(c: ChallengeSummary): 'cancel' | 'quit' | null {
  if (c.state === 'upcoming' || (c.state === 'active' && c.today <= 1)) return 'cancel';
  return c.state === 'active' ? 'quit' : null;
}

/**
 * Whether this build shows the demo clock's "Next day" button (and the test reminder): in a development
 * build (T97) with EXPO_PUBLIC_DEMO_CLOCK exactly "true", or in any build with "always", which only the test
 * project's environment carries, for the judges' TestFlight build (T225; prod keeps "true", so its beta has
 * none). Remove with the `day_offset` column before `payments`.
 */
export function demoClockEnabled(flag: string | undefined = process.env.EXPO_PUBLIC_DEMO_CLOCK, dev: boolean = __DEV__): boolean {
  return flag === 'always' || (dev && flag === 'true');
}

/**
 * Whether "Next day" has a day to move this challenge to: while it runs, and when its misses ended it today, since
 * its shield offer opens tomorrow (a judge shouldn't have to wait for midnight). Not once the offer is open, because
 * another day would close it, and not after a quit, which is never offered one.
 */
export function demoClockCanMove(c: Pick<ChallengeSummary, 'state' | 'quit' | 'endedOnDay' | 'today'>): boolean {
  if (c.state === 'active' || c.state === 'upcoming') return true;
  return c.state === 'not_finished' && !c.quit && c.endedOnDay !== null && c.today <= c.endedOnDay;
}

/** Shields as words, for VoiceOver and anyone who doesn't read the icons: "1 of 2 shields left". */
export function shieldsLabel(left: number, total = SHIELDS): string {
  return left === 0 ? 'No shields left' : `${left} of ${total} shields left`;
}

/** The finish card's shields line: "Never missed a day" with every shield left, otherwise "1 of 2 shields left". */
export function finishShieldsLine(left: number, total = SHIELDS): string {
  return left === total ? 'Never missed a day' : shieldsLabel(left, total);
}

/** "Finished", or "Finished, with 1 bought shield" (owner, 2026-10-01: friends and backers see it). */
export function finishedText(boughtShields: number): string {
  return boughtShields ? `Finished, with ${boughtShields} bought shield${boughtShields === 1 ? '' : 's'}` : 'Finished';
}

/** A missed day in words, for the Days list friends and backers see: whether a shield was bought for it. */
export function missedDayText(d: { day: number; boughtCents: number | null }): string {
  return d.boughtCents === null ? `Day ${d.day}: missed, a shield broke` : `Day ${d.day}: missed, shield bought (${money(d.boughtCents)})`;
}

/** A plain sentence for a refused shield purchase (buy_shield(), migration 0039). */
export function shieldErrorMessage(error: { code?: string; message?: string }): string {
  const message = error.message ?? '';
  if (message.includes('shield_not_available')) return 'A shield can be bought only on the day after the miss that ended the challenge.';
  if (message.includes('shield_limit')) return `A challenge can buy up to ${MAX_BOUGHT_SHIELDS} shields.`;
  if (message.includes('duplicate_challenge')) return 'You’ve started another challenge for this habit, so this one can’t reopen.';
  if (message.includes('outstanding_stake_limit')) return `Reopening it would put more than $${STAKE_LIMITS.outstandingMaxDollars} at stake on running challenges.`;
  if (!error.code) return 'Couldn’t reach Kept. Check your connection and try again.';
  return 'Kept couldn’t buy the shield. Please try again.';
}

/**
 * Where an ended challenge's stake went, for Past challenges (T137): back to the challenger after a
 * finish or a cancel, to the charity otherwise (a quit included).
 */
export function pastMoney(c: Pick<ChallengeSummary, 'state' | 'stakeDollars' | 'charityName'>): { amount: string; line: string } {
  const back = c.state === 'finished' || c.state === 'cancelled';
  return { amount: `$${c.stakeDollars}`, line: back ? 'back to you' : `to ${c.charityName}` };
}

/** Why an account can't be deleted yet (decision 103; delete_account() refuses the same, 0052). Sooner is by writing to Kept (decision 151). */
export const DELETION_BLOCKED_MESSAGE =
  'You can delete your account once every challenge you’re in, and every challenge you back, has ended. Cancel or quit a challenge of yours from its page. To delete it sooner, write to hello@habitkept.com.';

/**
 * Whether money is still promised (decision 103): `running` is how many of your own challenges haven't
 * ended; `pledgeOutcomes` are the outcomes of the challenges you back (null while running).
 */
export function deletionBlockedMessage(running: number, pledgeOutcomes: (string | null)[]): string | null {
  return running > 0 || pledgeOutcomes.includes(null) ? DELETION_BLOCKED_MESSAGE : null;
}

/** Why an account with money in Kept can't be deleted yet (decision 151; delete_account() refuses the same, 0065). */
export const MONEY_IN_KEPT_MESSAGE =
  'You have money in Kept. Spend your Kept balance on a stake or pledge, and choose where any money waiting in Wallet goes, before deleting your account. To have it sent back instead, write to hello@habitkept.com.';

/** Whether the account still holds money (decision 151): Kept balance, or money coming back that waits for a choice. */
export function moneyInKeptMessage(balanceCents: number, waiting: number): string | null {
  return balanceCents > 0 || waiting > 0 ? MONEY_IN_KEPT_MESSAGE : null;
}

/** A completion rate as SPEC.md writes it, "3 of 5, 60%", or "None ended yet" (a friend's profile, T23). */
export function completionRateText({ finished, ended, percent }: { finished: number; ended: number; percent: number }): string {
  return ended ? `${finished} of ${ended}, ${percent}%` : 'None ended yet';
}

/**
 * Your profile's completion numbers: challenges finished and the completion rate (finished ÷ ended). The money
 * given to charity is the donations table's total (useMyDonations, T208), so Home, Me and Wallet agree.
 */
export function meStats(summaries: ChallengeSummary[]): { finished: number; ended: number; percent: number } {
  const ended = summaries.filter((c) => c.state === 'finished' || c.state === 'not_finished');
  return completionRate(ended.map((c) => c.state as 'finished' | 'not_finished'));
}
