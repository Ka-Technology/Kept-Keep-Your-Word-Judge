// The pledge rules as the app shows them (SPEC-pledges.md, T31): the limits, when a pledge can be
// withdrawn, what became of a stake or pledge (Wallet), the user's own donations (T62), and
// database refusals as plain sentences.
// Migration 0022's triggers enforce the same numbers; supabase/tests/pledges_rls.sql proves it.
// Where the money goes at the end is settle() in challenge-rules.ts.

import { CREDIT_RATES, creditsFor, pledgeDonated, pledgeRewards, type CheckInStatus, type DonationSource, type Ending } from './challenge-rules';
import { money, type ChallengeRow, type ChallengeState } from './challenges';
import type { FriendRow } from './friends';

/**
 * Pledge limits (owner, 2026-09-27): whole dollars, $5 to $100 each, $300 pending per person, and since
 * 2026-10-28 at most $1,000 in pledges on one challenge (decision 155; migration 0066).
 */
export const PLEDGE_LIMITS = { minDollars: 5, maxDollars: 100, outstandingMaxDollars: 300, challengeMaxDollars: 1000 };

const dollarsText = (dollars: number) => `$${dollars.toLocaleString('en-US')}`;
const FULL_TEXT = `This challenge is full: a challenge can take up to ${dollarsText(PLEDGE_LIMITS.challengeMaxDollars)} in pledges.`;

/** What a challenge can still take in pledges, in dollars, given everything pledged on it. */
function challengeRoomDollars(challengeTotalCents: number): number {
  return Math.max(PLEDGE_LIMITS.challengeMaxDollars - challengeTotalCents / 100, 0);
}

/** Whether a challenge can take no more: not even the smallest new pledge, or a $1 raise. */
export function challengeFull(challengeTotalCents: number, raising: boolean): boolean {
  return challengeRoomDollars(challengeTotalCents) < (raising ? 1 : PLEDGE_LIMITS.minDollars);
}

/** "It can take $850 more.", or that it's full, for the pledge sheet. */
export function challengeRoomText(challengeTotalCents: number, raising: boolean): string {
  return challengeFull(challengeTotalCents, raising) ? FULL_TEXT : `It can take ${dollarsText(challengeRoomDollars(challengeTotalCents))} more.`;
}

/**
 * Why a pledge amount can't be used, or null if it can. `currentDollars` is the pledge being raised
 * (0 for a new one); `outstandingCents` is everything the pledger has pledged on challenges that
 * haven't ended, the current pledge included; `challengeTotalCents` is everything pledged on this
 * challenge, theirs included. Same order as the database triggers.
 */
export function pledgeError(
  dollars: number | null,
  { currentDollars, outstandingCents, challengeTotalCents = 0 }: { currentDollars: number; outstandingCents: number; challengeTotalCents?: number },
): string | null {
  const { minDollars, maxDollars, outstandingMaxDollars } = PLEDGE_LIMITS;
  if (dollars === null) return 'Enter an amount in whole dollars, like 25.';
  if (dollars < minDollars) return `The smallest pledge is $${minDollars}.`;
  if (dollars > maxDollars) return `A pledge can be up to $${maxDollars}.`;
  if (currentDollars > 0 && dollars <= currentDollars) return `You can only raise a pledge: enter more than $${currentDollars}.`;
  const outstanding = outstandingCents / 100;
  const room = outstandingMaxDollars - outstanding; // dollars that still fit under the total
  if (dollars - currentDollars > room) {
    const pledged = `You have $${outstanding} pledged on challenges that haven’t ended, and the total can be up to $${outstandingMaxDollars}.`;
    return room < (currentDollars > 0 ? 1 : minDollars)
      ? `${pledged} Wait for one to end before pledging again.`
      : `${pledged} You can pledge up to $${currentDollars + room} now.`;
  }
  const challengeRoom = challengeRoomDollars(challengeTotalCents);
  if (dollars - currentDollars > challengeRoom) {
    if (challengeFull(challengeTotalCents, currentDollars > 0)) return FULL_TEXT;
    const upTo = currentDollars > 0 ? `raise yours up to $${currentDollars + challengeRoom}` : `pledge up to $${challengeRoom}`;
    return `This challenge can take $${challengeRoom} more in pledges, so you can ${upTo}.`;
  }
  return null;
}

/** One of the user's own pledges, as `my_pledges()` returns it (migration 0022). */
export type MyPledge = {
  challenge_id: string;
  kind: 'supporter' | 'backer';
  amount_cents: number;
  donate_if_not_finished: boolean;
  /** The pledger chose the charity over rewarding the challenger if they finish (decision 143, migration 0060). */
  to_charity_on_finish: boolean;
  /** The challenger's username on a supporter's pledge; null on a backer's, who never learns it (0027). */
  challenger: string | null;
  habit: string;
  charity: string;
  outcome: Ending | null;
  withdrawable: boolean;
  /** Where it goes on a finish can still change: for 24 hours after paying, while the challenge runs (decision 149). */
  choice_open: boolean;
};

/** A pledge on the challenger's own challenge, as `challenge_pledges()` returns it: a supporter by name, a backer by letter. */
export type ChallengePledge = {
  kind: 'supporter' | 'backer';
  username: string | null;
  avatar_path: string | null;
  backer: string | null;
  amount_cents: number;
  donate_if_not_finished: boolean;
  to_charity_on_finish: boolean;
};

/**
 * What tapping someone in a challenge's "Who's backing you" opens (owner, 2026-10-02): a friend's
 * profile, a preview of a supporter who isn't a friend any more (photo, when they joined, friends in
 * common), or nothing for a backer, who stays anonymous (SPEC-pledges.md decision 9).
 */
export function pledgerProfile(
  pledge: Pick<ChallengePledge, 'kind' | 'username'>,
  friends: Pick<FriendRow, 'user_id' | 'username' | 'status'>[],
): { kind: 'friend'; userId: string } | { kind: 'preview'; username: string } | { kind: 'anonymous' } {
  if (pledge.kind === 'backer' || !pledge.username) return { kind: 'anonymous' };
  const friend = friends.find((f) => f.status === 'accepted' && f.username === pledge.username);
  return friend ? { kind: 'friend', userId: friend.user_id } : { kind: 'preview', username: pledge.username };
}

/** A challenge's pledge total and count, as `pledge_summaries()` returns it. */
export type PledgeSummary = { challenge_id: string; total_cents: number; pledgers: number };

/**
 * The user's Kept credits (T45): worked out from their backer pledges on finished challenges, never
 * stored, so nothing can withdraw, send or spend them. Pretend in the demo; spent on the fee with `payments`.
 */
export function creditBalanceCents(pledges: { kind: 'supporter' | 'backer'; amount_cents: number; outcome: Ending | null }[]): number {
  return pledges.reduce((sum, p) => sum + creditsFor(p.kind, p.amount_cents, p.outcome), 0);
}

/** What the user has pledged on challenges that haven't ended (the $300 limit). */
export function pendingPledgeCents(pledges: { amount_cents: number; outcome: string | null }[]): number {
  return pledges.filter((p) => p.outcome === null).reduce((sum, p) => sum + p.amount_cents, 0);
}

/** Whether a pledge can still be withdrawn: until the end of the challenge's Day 1 (SPEC.md money rules). */
export function canWithdrawPledge({ state, today }: { state: ChallengeState; today: number }): boolean {
  return state === 'upcoming' || (state === 'active' && today <= 1);
}

/** A challenge's pledges in a few words: "2 people have pledged $50", or "No pledges yet". */
export function pledgeSummaryText({ totalCents, pledgers }: { totalCents: number; pledgers: number }): string {
  if (pledgers === 0) return 'No pledges yet';
  return `${pledgers} ${pledgers === 1 ? 'person has' : 'people have'} pledged $${totalCents / 100}`;
}

type Outcome = Ending | null;

/** What became of the user's own stake, for Wallet. */
export function stakeFate(outcome: Outcome, charityName: string): string {
  if (outcome === 'cancelled') return 'Came back to you (cancelled)';
  if (outcome === 'finished') return 'Came back to you';
  if (outcome === 'not_finished') return `Went to ${charityName}`;
  return 'Staked, challenge running';
}

/**
 * What became of a pledge, for Wallet: on a finish, the challenger's reward unless the pledger chose
 * the charity (decision 143); on a failure, back unless they chose to donate either way.
 */
export function pledgeFate(p: Pick<MyPledge, 'outcome' | 'donate_if_not_finished' | 'to_charity_on_finish' | 'charity'>): string {
  const choices = { donateIfNotFinished: p.donate_if_not_finished, toCharityOnFinish: p.to_charity_on_finish };
  if (p.outcome === 'cancelled') return 'Came back to you (cancelled)';
  if (p.outcome && pledgeDonated(choices, p.outcome)) return `Went to ${p.charity}`;
  if (p.outcome && pledgeRewards(choices, p.outcome)) return 'Went to the challenger, as their reward';
  if (p.outcome === 'not_finished') return 'Came back to you';
  return 'Pledged, challenge running';
}

/** Money waiting for its owner's choice (T189), as `my_money_back()` returns it (migration 0063). */
export type MoneyBack = { id: string; kind: 'return' | 'reward'; source: 'stake' | 'pledge'; amount_cents: number; habit: string; created_at: string };

/** A crypto stake or pledge leaving the treasury (T170), as the `solana_payouts` table holds it (migration 0072). */
export type SolanaPayout = {
  challenge_id: string;
  kind: 'return' | 'donation' | 'reward';
  status: 'due' | 'sent' | 'confirmed' | 'failed';
  signature: string | null;
  amount_cents: number;
};

/** Where crypto coming out of Kept is: "Back to your wallet", or "Going to {charity}" (that leg waits for Every.org's donation endpoint). */
export function solanaPayoutText(p: Pick<SolanaPayout, 'kind' | 'status'>, charityName: string): string {
  if (p.kind === 'donation') return `Going to ${charityName}`;
  if (p.status === 'confirmed') return 'Back to your wallet';
  if (p.status === 'failed') return 'Couldn’t reach your wallet yet. Kept is looking into it';
  return 'On its way to your wallet';
}

/**
 * A transaction, or with 'address' an account such as a stake's escrow (T231), on Solscan; `cluster` is
 * EXPO_PUBLIC_SOLANA_PAY ("devnet" while testing). Not Solana's own Explorer: its page talks to devnet from the phone,
 * and says "RPC is not responding" when that's refused (2026-11-06). Solscan serves the chain from its own backend.
 */
export function explorerUrl(id: string, cluster: string, kind: 'tx' | 'address' = 'tx'): string {
  return `https://solscan.io/${kind === 'address' ? 'account' : 'tx'}/${id}${cluster === 'mainnet' ? '' : `?cluster=${cluster}`}`;
}

/** A reward still inside its 14 days (decision 154), as `my_reward_waits()` returns it (migration 0070). */
export type RewardWait = { challenge_id: string; habit: string; amount_cents: number; cashable_at: string };

/** "Can go to your bank from Nov 11", dated in `timeZone` (the phone's when left out). Bank payouts come with T190. */
export function bankFromText(cashableAt: string, timeZone?: string): string {
  return `Can go to your bank from ${new Date(cashableAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })}`;
}

/**
 * Wallet's Kept balance row. Below zero only after a take-back (T194, decision 153): a pledge in the person's
 * reward was taken back by its bank after they'd spent the reward, so the next money in pays it off first.
 */
export function keptBalanceRow(cents: number): { value: string; detail?: string } {
  if (cents >= 0) return { value: money(cents) };
  return { value: `−${money(-cents)}`, detail: 'Owed: a pledge in your reward was taken back by its bank. It comes out of the next money you get in Kept.' };
}

/** A take-back in Wallet (`my_takebacks()`, migration 0068), by its habit: the pledger is never named. */
export function takebackLabel(habit: string): string {
  return `A pledge on ${habit} was taken back by its bank`;
}

/** Days a return waits for a choice before it goes back to its card on its own (decision 158; 0067's unchosen_returns()). */
export const SEND_BACK_DAYS = 14;

/** "Choose where it goes, or it goes back to your card on Nov 11", dated in `timeZone` (the phone's when left out). */
export function moneyBackDetail(m: Pick<MoneyBack, 'kind' | 'created_at'>, timeZone?: string): string {
  if (m.kind !== 'return') return 'Choose where it goes';
  const on = new Date(Date.parse(m.created_at) + SEND_BACK_DAYS * 86_400_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
  return `Choose where it goes, or it goes back to your card on ${on}`;
}

/** "Your reward: Work out", "Your stake back: Read", "Your pledge back: Journal". */
export function moneyBackLabel(m: Pick<MoneyBack, 'kind' | 'source' | 'habit'>): string {
  if (m.kind === 'reward') return `Your reward: ${m.habit}`;
  return `${m.source === 'stake' ? 'Your stake' : 'Your pledge'} back: ${m.habit}`;
}

/** A plain sentence for a refused pledge (never the raw database error). */
export function pledgeErrorMessage(error: { code?: string; message?: string }): string {
  const message = error.message ?? '';
  if (message.includes('pledge_not_friend')) return 'Only friends can back this challenge.';
  if (message.includes('pledge_backer_window')) return 'Backers can pledge only in a challenge’s first 7 days.';
  if (message.includes('pledge_own_challenge')) return 'You can’t back your own challenge.';
  // A block either way (T53): no reason given, so no one learns they were blocked.
  if (message.includes('pledge_not_allowed')) return 'You can’t back this challenge.';
  if (message.includes('pledge_challenge_ended')) return 'This challenge has ended, so it can’t take pledges.';
  if (message.includes('pledge_outstanding_limit')) {
    return `Your pledges on challenges that haven’t ended can be up to $${PLEDGE_LIMITS.outstandingMaxDollars} in total.`;
  }
  if (message.includes('pledge_challenge_full')) return FULL_TEXT;
  if (message.includes('pledge_payment_waiting')) return 'Your wallet may still be sending your last payment. Try again in a few minutes.';
  if (message.includes('pledge_crypto_challenge_only')) return 'Only a challenge paid in crypto takes crypto pledges. Pay by card instead.';
  if (message.includes('pledge_only_raise')) return 'You can only raise a pledge, not lower it.';
  if (message.includes('pledge_not_withdrawable')) return 'Pledges can be withdrawn only until the end of Day 1.';
  if (message.includes('pledge_choice_fixed')) return 'Where your pledge goes if they finish can change only for 24 hours after you pledge.';
  if (error.code === '23505') return 'You’ve already backed this challenge. You can raise your pledge.';
  if (message.includes('pledges_amount_cents_check')) {
    return `Pledges are whole dollars from $${PLEDGE_LIMITS.minDollars} to $${PLEDGE_LIMITS.maxDollars}.`;
  }
  if (!error.code) return 'Couldn’t reach Kept. Check your connection and try again.';
  return 'Kept couldn’t save your pledge. Please try again.';
}

/** Extra gifts at the end (SPEC-pledges.md decision 11): whole dollars, $1 to $100, one each, raised only. */
export const GIFT_LIMITS = { minDollars: 1, maxDollars: 100 };

/** Why an extra gift can't be used, or null if it can. `currentDollars` is the gift being raised (0 for a new one). */
export function giftError(dollars: number | null, currentDollars: number): string | null {
  const { minDollars, maxDollars } = GIFT_LIMITS;
  if (dollars === null) return 'Enter an amount in whole dollars, like 10.';
  if (dollars < minDollars) return `The smallest gift is $${minDollars}.`;
  if (dollars > maxDollars) return `A gift can be up to $${maxDollars}.`;
  if (currentDollars > 0 && dollars <= currentDollars) return `You can only raise a gift: enter more than $${currentDollars}.`;
  return null;
}

/** A plain sentence for a refused extra gift (never the raw database error). */
export function giftErrorMessage(error: { code?: string; message?: string }): string {
  const message = error.message ?? '';
  if (message.includes('gift_challenge_running')) return 'Gifts can be added once the challenge has ended.';
  if (message.includes('gift_not_allowed')) return 'Only the challenger and people who pledged can add a gift.';
  if (message.includes('gift_only_raise')) return 'You can only raise a gift, not lower it.';
  if (error.code === '23505') return 'You’ve already given. You can raise your gift.';
  if (message.includes('extra_gifts_amount_cents_check')) return `Gifts are whole dollars from $${GIFT_LIMITS.minDollars} to $${GIFT_LIMITS.maxDollars}.`;
  if (!error.code) return 'Couldn’t reach Kept. Check your connection and try again.';
  return 'Kept couldn’t save your gift. Please try again.';
}

/** One of the user's own donations, as the `donations` table records it (migration 0033, T62), with its charity's name. */
export type MyDonation = {
  id: string;
  source: DonationSource;
  amount_cents: number;
  habit: string;
  created_at: string;
  /** `owed` until Kept gives it to the charity (monthly, by hand: migration 0089), then `given` on `given_on` (a date). */
  status: 'owed' | 'given';
  given_on: string | null;
  charities: { name: string } | null;
};

const SOURCE_WORDS: Record<DonationSource, string> = { stake: 'Your stake', pledge: 'Your pledge', gift: 'Your extra gift', shield: 'Your bought shields' };

/** What a donation came from, for Wallet: "Your pledge on Read". */
export function donationDetail(source: DonationSource, habit: string): string {
  return `${SOURCE_WORDS[source]} on ${habit}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Where a donation stands, for Wallet: "On its way", or "Given Dec 1 by Kept" (Kept gives in its own name, decision 177). */
export function donationState(d: { status: 'owed' | 'given'; given_on: string | null }): string {
  if (d.status !== 'given' || !d.given_on) return 'On its way';
  const [, month, day] = d.given_on.split('-').map(Number);
  return `Given ${MONTHS[month - 1]} ${day} by Kept`;
}

/** Everything the user has given to charity, in cents. */
export function donationsTotalCents(donations: { amount_cents: number }[]): number {
  return donations.reduce((sum, d) => sum + d.amount_cents, 0);
}

/** Backers can pledge only in a public challenge's first 7 days (decision 3), so it can be made public until then. */
export const BACKER_WINDOW_DAYS = 7;

/** Whether a running challenge can still be made public (a trigger in migration 0024 agrees). */
export function canMakePublic({ state, today }: { state: ChallengeState; today: number }): boolean {
  return state === 'upcoming' || (state === 'active' && today <= BACKER_WINDOW_DAYS);
}

/**
 * What Kept credits are (T209: a tester met the words with nothing to explain them), in one place for the pledge
 * sheet, Wallet, Discover and the rules. The numbers are creditsFor()'s (decision 118); spent by T164.
 */
export const KEPT_CREDITS_EXPLAINED =
  `Kept credits are a rebate on Kept’s service fee for backing someone you don’t know. Back a public challenge from Discover, and if it finishes you earn ${CREDIT_RATES.backer * 100}% of your pledge, never more than the service fee you paid on it. Backing a friend earns none. ` +
  'Credits pay Kept’s service fee on your next stakes and pledges by themselves. They aren’t money: they can’t pay a stake or a pledge, and they can’t be cashed out or sent.';

/** The pledge sheet's line on credits: what this pledge would earn if the challenger finishes, or the rule until there's an amount. */
export function backerCreditsText(name: string, pledgeCents: number | null): string {
  return pledgeCents
    ? `As a backer, you’d earn ${money(creditsFor('backer', pledgeCents, 'finished'))} in Kept credits if ${name} finishes.`
    : `As a backer, you earn Kept credits if ${name} finishes: ${CREDIT_RATES.backer * 100}% of your pledge, never more than its service fee.`;
}

/** Whether a Discover card matches what's typed in its search (T206): the habit, the charity, or a friend's username (with or without its @). */
export function matchesDiscover(query: string, card: { habit: string; charity: string; username?: string }): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const fields = [card.habit, card.charity, ...(card.username ? [card.username, `@${card.username}`] : [])];
  return fields.some((field) => field.toLowerCase().includes(q));
}

/**
 * The pledge screen's title: "Back @sam" or "Back this challenge" while it runs; once it has ended, that it has,
 * since nobody can back it any more (T205: the screen used to ask with nothing to tap).
 */
export function backHeading({ running, known, isFriend, pledged }: { running: boolean; known?: string; isFriend: boolean; pledged: boolean }): {
  title: string;
  subtitle?: string;
} {
  if (!running) {
    return { title: 'This challenge has ended', subtitle: !pledged ? 'It can’t be backed any more.' : known ? `@${known}’s challenge` : 'One you backed' };
  }
  if (known) return { title: `Back @${known}` };
  return { title: 'Back this challenge', subtitle: isFriend ? 'A friend’s challenge' : 'A public challenge' };
}

/**
 * A public challenge as `discover_challenges()` returns it (Discover's Public group): only its
 * progress (decision 7, revised 2026-09-27), never who it is (no username, photo or id), a stake or a profile.
 */
export type DiscoverRow = {
  id: string;
  habit_id: string;
  habit: string;
  language: string | null;
  level: string | null;
  length_days: number;
  start_date: string;
  time_zone: string;
  day_offset: number;
  charity: string;
  /** The charity's Every.org slug (0081), for the "learn more" link. */
  charity_slug?: string | null;
  check_ins: { day: number; status: CheckInStatus }[];
  /** Revival shields bought (0039): backers see which missed days were bought back, and for how much. */
  shield_purchases?: { day: number; price_cents: number }[];
  total_cents: number;
  pledgers: number;
};

/** A Discover row as a ChallengeRow, so summarizeChallenge() works out its day and shields like any other. */
export function publicChallengeRow(d: DiscoverRow): ChallengeRow {
  return {
    id: d.id,
    habit_id: d.habit_id,
    language: d.language,
    level: d.level,
    length_days: d.length_days,
    stake_cents: 0,
    start_date: d.start_date,
    time_zone: d.time_zone,
    day_offset: d.day_offset,
    outcome: null,
    ended_on_day: null,
    payment_method: '',
    is_public: true,
    habits: { name: d.habit },
    charities: { name: d.charity, slug: d.charity_slug ?? null },
    check_ins: d.check_ins,
    shield_purchases: d.shield_purchases,
  };
}

/** The backer badge's words (decision 10), for a count of at least 1: "Backed 2 finished challenges". */
export function backerBadgeText(count: number): string {
  return `Backed ${count} finished challenge${count === 1 ? '' : 's'}`;
}

/**
 * Wallet's three numbers (owner, 2026-09-27): what's staked on the user's running challenges, their
 * Kept credits, and what they've pledged on challenges that haven't ended. All pretend in the demo.
 */
export function walletTotals(
  stakes: { state: ChallengeState; stakeDollars: number }[],
  pledges: { kind: 'supporter' | 'backer'; amount_cents: number; outcome: Ending | null }[],
): { stakedCents: number; creditsCents: number; pledgedCents: number } {
  return {
    stakedCents: stakes.filter((c) => c.state === 'upcoming' || c.state === 'active').reduce((sum, c) => sum + c.stakeDollars * 100, 0),
    creditsCents: creditBalanceCents(pledges),
    pledgedCents: pendingPledgeCents(pledges),
  };
}
