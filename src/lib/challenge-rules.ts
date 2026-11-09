// The challenge rules from SPEC-challenges.md, as pure functions: which day a challenge is on,
// shields (and revival shields), misses and the outcome, where every dollar goes, the example service fee and the
// completion rate. No React, Supabase or clock reads (the time is passed in), so the same file can
// run in an Edge Function when `payments` makes the server the authority. Screens never repeat a
// rule: every number they show comes from here (tested in challenge-rules.test.ts).

/** A check-in's status (SPEC-verification.md). `verification` moves a check-in between these; this file only reads them. */
export type CheckInStatus = 'pending' | 'flagged' | 'ai_checking' | 'retake' | 'approved' | 'rejected' | 'appealed' | 'excused';

/** Still being checked: by a friend, the AI, or waiting for a retake. Kept's job, so done once the day ends. */
export const UNDER_REVIEW: CheckInStatus[] = ['pending', 'flagged', 'ai_checking', 'retake'];

/** What the rules need to know about a challenge. */
export type ChallengeFacts = {
  /** Completed days needed to finish: 28 to 365 (SPEC-challenges.md). */
  lengthDays: number;
  stakeCents: number;
  /** At most one check-in per day; days are numbered from 1. */
  checkIns: { day: number; status: CheckInStatus }[];
  /** Shields in all: SHIELDS plus any revival shields bought (default SHIELDS). A free tracker sets its own, 0 to 3. */
  shields?: number;
};

/** A challenge still running, or how it ended. */
export type Outcome = 'active' | 'finished' | 'not_finished';

/**
 * Shields every challenge starts with (owner, 2026-10-01: 2, so "0 shields left" still runs). Each
 * miss breaks one; a miss with none left ends the challenge, so the third miss ends it, as before.
 */
export const SHIELDS = 2;

/** Revival shields one challenge can buy (owner, 2026-10-01). */
export const MAX_BOUGHT_SHIELDS = 3;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The calendar date at `now` in `timeZone`, as YYYY-MM-DD. It reads the date in parts rather than
 * relying on any locale's layout, so it's the same in Node (tests) and on the phone.
 */
export function calendarDate(timeZone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const [year, month, day] = [part('year'), part('month'), part('day')];
    if ([year, month, day].some(Number.isNaN)) throw new Error('unreadable date');
    return `${year}-${pad(month)}-${pad(day)}`;
  } catch {
    // ponytail: without Intl time zones this uses the phone's own calendar, which is only wrong for a
    // challenger who has since moved to another zone. Add a time-zone library if that ever matters.
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
}

/**
 * The challenge's current day number: 0 before it starts, 1 on its start date. Days are calendar
 * dates in the challenge's own time zone, so a daylight-saving day just runs 23 or 25 hours.
 * `dayOffset` is the demo clock (SPEC-challenges.md). The SQL function `challenge_day()` must agree.
 */
export function challengeDay(startDate: string, timeZone: string, dayOffset: number, now: Date): number {
  const today = calendarDate(timeZone, now);
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
  return Math.max(0, days + dayOffset + 1);
}

/**
 * Where a challenge stands on day `today` (from challengeDay). Ended days count in order:
 * approved, excused, or still being checked when the day ended = done; rejected, appealed or no
 * check-in = a miss. Today counts as done once it's approved or excused, and otherwise stays open.
 * The challenge finishes when completed days reach the length, and ends unfinished on a miss with no
 * shield left (facts.shields); nothing after the day it ended counts. The SQL function
 * `challenge_progress()` (migration 0039) is its twin and must agree.
 */
export function progress(
  facts: ChallengeFacts,
  today: number,
): {
  daysCompleted: number;
  misses: number;
  shieldsLeft: number;
  /** Calendar days needed: the length plus one per miss ("Day 5 of 29"). */
  daysRequired: number;
  outcome: Outcome;
  endedOnDay: number | null;
  /** A day counted as done is still being checked: a finish waits until it's decided (0039). */
  underReview: boolean;
} {
  const statusOn = new Map(facts.checkIns.map((c) => [c.day, c.status]));
  const shields = facts.shields ?? SHIELDS;
  let daysCompleted = 0;
  let misses = 0;
  let outcome: Outcome = 'active';
  let endedOnDay: number | null = null;
  let underReview = false;

  for (let day = 1; day <= today; day++) {
    const status = statusOn.get(day);
    const ended = day < today;
    if (status === 'approved' || status === 'excused' || (ended && status && UNDER_REVIEW.includes(status))) {
      underReview ||= !!status && UNDER_REVIEW.includes(status);
      daysCompleted++;
      if (daysCompleted === facts.lengthDays) {
        outcome = 'finished';
        endedOnDay = day;
        break;
      }
    } else if (ended) {
      misses++;
      if (misses > shields) {
        outcome = 'not_finished';
        endedOnDay = day;
        break;
      }
    }
  }

  return {
    daysCompleted,
    misses,
    shieldsLeft: Math.max(0, shields - misses),
    daysRequired: facts.lengthDays + misses,
    outcome,
    endedOnDay,
    underReview,
  };
}

/**
 * The price of the challenge's `nth` revival shield (1 to MAX_BOUGHT_SHIELDS; owner, 2026-10-01):
 * 20%, 40%, then 60% of the stake, in whole dollars rounded up, at least $5. $35 → $7, $14, $21.
 * buy_shield() (migration 0039) charges the same.
 */
export function shieldPriceCents(stakeCents: number, nth: number): number {
  return Math.max(500, Math.ceil((stakeCents * nth) / 500) * 100);
}

/** Where a revival shield's price goes: half to the charity in the challenger's name, half to Kept. No fee on top. */
export function shieldSplit(priceCents: number): { charityCents: number; keptCents: number } {
  return { charityCents: priceCents / 2, keptCents: priceCents / 2 };
}

/**
 * Kept credits per pledge kind (SPEC-pledges.md decision 9; owner, 2026-09-27): friends back a
 * friend for the friendship, backers earn a share of their pledge toward Kept's own service fee.
 * The only place the rates live; they can change. Credits are "earned", never a return.
 */
export const CREDIT_RATES = { supporter: 0, backer: 0.1 };

/**
 * The credits a pledge earns: its kind's rate, rounded down to the cent, only when the challenger
 * finishes, and never more than the pledge's own service fee (owner, 2026-10-21; legal review 2.4),
 * so credits are a rebate on what the backer paid Kept, never a prize.
 */
export function creditsFor(kind: keyof typeof CREDIT_RATES, amountCents: number, outcome: Ending | null): number {
  return outcome === 'finished' ? Math.min(Math.floor(amountCents * CREDIT_RATES[kind]), serviceFeeCents(amountCents)) : 0;
}

/**
 * How much of a fee a person's Kept credits pay (T164): all they have left, never more than the fee, so a
 * card charge is the amount plus whatever fee is left. The twin of charges_apply_credits() (migration 0062).
 */
export function creditsOnFee(feeCents: number, creditsLeftCents: number): number {
  return Math.min(feeCents, Math.max(creditsLeftCents, 0));
}

/**
 * What a card charge comes to (T189, decision 145), the twin of charges_apply_credits() (migration 0063):
 * Kept balance pays as much of the amount as it can, the fee is worked out on what the card pays (none when
 * the balance covers it all), then credits come off that fee. What's left for the card is never under Stripe's
 * 50¢ minimum: credits take less instead. `feeCents` is the fee before any of that (a raise's difference).
 */
export function chargeFor(
  amountCents: number,
  feeCents: number,
  { creditsLeftCents = 0, balanceLeftCents = 0 }: { creditsLeftCents?: number; balanceLeftCents?: number } = {},
): { balanceCents: number; feeCents: number; creditsCents: number; totalCents: number } {
  const balanceCents = Math.min(amountCents, Math.max(balanceLeftCents, 0));
  const card = amountCents - balanceCents;
  const fee = card === 0 ? 0 : Math.min(feeCents, serviceFeeCents(card));
  let creditsCents = creditsOnFee(fee, creditsLeftCents);
  if (card > 0 && card + fee - creditsCents < 50) creditsCents = Math.max(card + fee - 50, 0);
  return { balanceCents, feeCents: fee, creditsCents, totalCents: card + fee - creditsCents };
}

/** A pledge behind the challenge (`pledges` module): a supporter's (a friend) or a backer's. */
export type Pledge = {
  kind: keyof typeof CREDIT_RATES;
  amountCents: number;
  /** The supporter chose to donate even if the challenger doesn't finish. */
  donateIfNotFinished: boolean;
  /** The pledger chose the charity over rewarding the challenger if they finish (decision 143). Unset is the reward. */
  toCharityOnFinish?: boolean;
};

/** Where every dollar goes once a challenge has ended (SPEC.md's money table). All in cents. */
export type Settlement = {
  stakeToChallengerCents: number;
  stakeToCharityCents: number;
  pledgesToCharityCents: number;
  /** The finisher's reward: every pledge whose pledger didn't choose the charity (owner, 2026-10-27, decision 143). */
  pledgesToChallengerCents: number;
  pledgesRefundedCents: number;
  extraGivingToCharityCents: number;
  /** The charity's half of every revival shield bought, whatever the ending. */
  shieldsToCharityCents: number;
  /** Kept's half of them: the one place Kept earns from a miss (owner, 2026-10-01; for the lawyer). */
  shieldsToKeptCents: number;
  /** What the charity receives in total: stake, pledges, shields and extra giving. */
  charityTotalCents: number;
  /** Kept's service fee, on top of the stake and never waived (the example fee in the demo). */
  serviceFeeCents: number;
  /** Each pledge's Kept credits, in the pledges' order: paid from Kept's fee, never from anyone's money. */
  creditsCents: number[];
};

/**
 * How a challenge ended: finished, not finished (a miss with no shield left, or quitting after Day 1), or
 * cancelled until the end of Day 1 (T52; SPEC.md money rules). Recorded in `challenges.outcome`.
 */
export type Ending = 'finished' | 'not_finished' | 'cancelled';

/**
 * Settles an ended challenge. Finished: the stake goes back, and each pledge goes to the challenger as
 * their reward unless its pledger chose the charity (decision 143, the one place money moves between
 * users). Not finished: the stake goes to the charity, and pledges are refunded unless their pledger
 * chose to donate. Cancelled: the stake and every pledge come back. Extra giving, and the charity's
 * half of each revival shield (`shieldsCents`, their prices), go to the charity either way. The
 * service fee is kept in every case.
 */
export function settle(
  facts: ChallengeFacts,
  outcome: Ending,
  { pledges = [], extraGivingCents = 0, shieldsCents = 0 }: { pledges?: Pledge[]; extraGivingCents?: number; shieldsCents?: number } = {},
): Settlement {
  const pledged = pledges.reduce((sum, p) => sum + p.amountCents, 0);
  const pledgesToCharityCents = pledges.filter((p) => pledgeDonated(p, outcome)).reduce((sum, p) => sum + p.amountCents, 0);
  const pledgesToChallengerCents = pledges.filter((p) => pledgeRewards(p, outcome)).reduce((sum, p) => sum + p.amountCents, 0);
  const stakeToCharityCents = outcome === 'not_finished' ? facts.stakeCents : 0;
  const shields = shieldSplit(shieldsCents);

  return {
    stakeToChallengerCents: outcome === 'not_finished' ? 0 : facts.stakeCents,
    stakeToCharityCents,
    pledgesToCharityCents,
    pledgesToChallengerCents,
    pledgesRefundedCents: pledged - pledgesToCharityCents - pledgesToChallengerCents,
    extraGivingToCharityCents: extraGivingCents,
    shieldsToCharityCents: shields.charityCents,
    shieldsToKeptCents: shields.keptCents,
    charityTotalCents: stakeToCharityCents + pledgesToCharityCents + extraGivingCents + shields.charityCents,
    serviceFeeCents: serviceFeeCents(facts.stakeCents),
    creditsCents: pledges.map((p) => creditsFor(p.kind, p.amountCents, outcome)),
  };
}

/** The two choices a pledger makes about where their pledge goes (SPEC-pledges.md decisions 5 and 13). */
type PledgeChoices = Pick<Pledge, 'donateIfNotFinished' | 'toCharityOnFinish'>;

/**
 * Whether a pledge goes to the charity: on a finish only if its pledger chose the charity over the
 * reward, on a failure only if they chose to donate either way, never on a cancel.
 */
export function pledgeDonated(p: PledgeChoices, outcome: Ending): boolean {
  return outcome === 'finished' ? !!p.toCharityOnFinish : outcome === 'not_finished' && p.donateIfNotFinished;
}

/** Whether a pledge becomes the challenger's reward: on a finish, unless its pledger chose the charity. */
export function pledgeRewards(p: PledgeChoices, outcome: Ending): boolean {
  return outcome === 'finished' && !p.toCharityOnFinish;
}

/** Where a donation to the charity comes from: the challenger's stake, a pledge, an extra gift at the end, or revival shields' charity half. */
export type DonationSource = 'stake' | 'pledge' | 'gift' | 'shield';

/** One donation to the charity, in its giver's name. `G` is however the caller names people (an id, a username, a letter). */
export type Donation<G> = { giver: G; source: DonationSource; amountCents: number };

/**
 * The donation route (T61): each donation an ended challenge makes to its charity, in its giver's
 * name. The stake when the challenger doesn't finish; the charity's half of the revival shields
 * bought (`shieldsCents`, their prices); each pledge that pledgeDonated() sends; every extra gift. It
 * always adds up to settle()'s charityTotalCents, and the database records the same rows
 * (record_donations(), T62). With `payments`, Kept sends each one to the charity through its
 * donation partner; in the demo nothing is sent.
 */
export function donations<G>(
  stakeCents: number,
  outcome: Ending,
  {
    challenger,
    pledges = [],
    gifts = [],
    shieldsCents = 0,
  }: { challenger: G; pledges?: (Pledge & { giver: G })[]; gifts?: { giver: G; amountCents: number }[]; shieldsCents?: number },
): Donation<G>[] {
  return [
    ...(outcome === 'not_finished' ? [{ giver: challenger, source: 'stake' as const, amountCents: stakeCents }] : []),
    ...(shieldsCents > 0 ? [{ giver: challenger, source: 'shield' as const, amountCents: shieldSplit(shieldsCents).charityCents }] : []),
    ...pledges
      .filter((p) => pledgeDonated(p, outcome))
      .map((p) => ({ giver: p.giver, source: 'pledge' as const, amountCents: p.amountCents })),
    ...gifts.map((g) => ({ giver: g.giver, source: 'gift' as const, amountCents: g.amountCents })),
  ];
}

/** Money that leaves Kept to a person once a challenge ends: back to whoever paid it, or a finisher's reward. */
export type Payout<G> = { to: G; giver: G; source: 'stake' | 'pledge'; kind: 'return' | 'reward'; amountCents: number };

/**
 * Who gets money back when a challenge ends (T188; plan.md decisions 143 and 144), the twin of
 * record_payouts() (migration 0060). Finished: the stake back to the challenger, and each pledge
 * that pledgeRewards() to the challenger. Not finished: each pledge that isn't donated back to its
 * pledger. Cancelled: the stake and every pledge back. With donations(), it accounts for every
 * dollar of the stake and pledges; the fee is Kept's and never moves.
 */
export function payouts<G>(stakeCents: number, outcome: Ending, { challenger, pledges = [] }: { challenger: G; pledges?: (Pledge & { giver: G })[] }): Payout<G>[] {
  return [
    ...(outcome === 'not_finished' ? [] : [{ to: challenger, giver: challenger, source: 'stake' as const, kind: 'return' as const, amountCents: stakeCents }]),
    ...pledges
      .filter((p) => !pledgeDonated(p, outcome))
      .map((p) => ({
        to: pledgeRewards(p, outcome) ? challenger : p.giver,
        giver: p.giver,
        source: 'pledge' as const,
        kind: pledgeRewards(p, outcome) ? ('reward' as const) : ('return' as const),
        amountCents: p.amountCents,
      })),
  ];
}

/**
 * Kept's service fee: $1.50 + 3% of the amount, never more than $9.99 (reached at $283), on a stake
 * or (since T63) a pledge (owner, 2026-10-23, after the 2026-10-22 council; 50¢ + 5% before; the cap was
 * $7.50 until 2026-10-27, decision 146, when charging cards up front made large stakes cost Kept money).
 * Amounts are whole dollars, so 3% is always whole cents; rounding only guards against other input.
 */
export function serviceFeeCents(stakeCents: number): number {
  return Math.min(150 + Math.round(stakeCents * 0.03), 999);
}

/**
 * What someone pays for a stake or a pledge (owner, 2026-09-29; T63): the amount, Kept's fee on
 * top, and the total. A $10 pledge is $10 + $1.80 = $11.80, never $10 with the fee taken out. Only
 * the amount goes to the charity or back; the fee is Kept's and isn't refunded. A raise pays the
 * difference between two totals, so its fee is 3% of the extra (nothing past the cap), not a second $1.50.
 */
export function feeBreakdown(amountCents: number): { amountCents: number; feeCents: number; totalCents: number } {
  const feeCents = serviceFeeCents(amountCents);
  return { amountCents, feeCents, totalCents: amountCents + feeCents };
}

/** "3 of 5, 60%": finished out of ended challenges, as a whole percent (0 with none ended). */
export function completionRate(outcomes: ('finished' | 'not_finished')[]): {
  finished: number;
  ended: number;
  percent: number;
} {
  const finished = outcomes.filter((o) => o === 'finished').length;
  const ended = outcomes.length;
  return { finished, ended, percent: ended ? Math.round((finished / ended) * 100) : 0 };
}
