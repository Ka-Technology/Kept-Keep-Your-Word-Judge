// Kept's badges (owner, 2026-10-02; the "Badges" boards on the brand canvas, extending decisions 25
// and 27): earned only with money on it, on a staked challenge or a pledge, never a free tracker.
// Three kinds: keeping (green), falling and getting up (red: Kept is honest about a miss), and giving
// (ink). Each is worked out from a person's challenges, which friends can read too, so your profile and a
// friend's page show the same thing; nothing is stored but the showcase (up to three chosen to lead
// the profile; until then the rarest lead). Secret badges (owner, 2026-10-03) are the hard ones: the
// Badges page hides what earns them until they're earned. badge_shares() (migration 0045) is the SQL
// twin, counting each badge's holders for the Badges page's "9.5% of Kept users". Pure, so tested in
// badges.test.ts.

import type { ChallengeSummary } from './challenges';

export type BadgeId =
  | 'first-step'
  | 'first-check-in'
  | 'kept-it'
  | 'unbroken'
  | 'hat-trick'
  | 'long-haul'
  | 'century'
  | 'high-stakes'
  | 'in-the-open'
  | 'two-at-once'
  | 'it-stuck'
  | 'well-rounded'
  | 'first-fall'
  | 'back-on-your-feet'
  | 'close-call'
  | 'unfinished-business'
  | 'second-wind'
  | 'good-for-a-cause'
  | 'in-your-corner'
  | 'always-there'
  | 'paying-it-forward'
  | 'ten-kept'
  | 'full-year'
  | 'clean-sweep'
  | 'against-the-odds'
  | 'full-range'
  | 'patron';

/** Keeping (green), falling and getting up (seal red), giving (ink). */
export type BadgeTone = 'kept' | 'fall' | 'give';

/** Every badge, in the order the Badges page lists them, with what earns it. `secret`: hidden until earned. */
export const BADGES: { id: BadgeId; name: string; how: string; tone: BadgeTone; secret?: true }[] = [
  { id: 'first-step', name: 'First step', how: 'Get past Day 1 of a challenge', tone: 'kept' },
  { id: 'first-check-in', name: 'First check-in', how: 'Have a day approved', tone: 'kept' },
  { id: 'kept-it', name: 'Kept it', how: 'Finish a challenge', tone: 'kept' },
  { id: 'unbroken', name: 'Unbroken', how: 'Finish a challenge without missing a day', tone: 'kept' },
  { id: 'hat-trick', name: 'Hat trick', how: 'Finish three challenges', tone: 'kept' },
  { id: 'long-haul', name: 'Long haul', how: 'Finish a challenge of 56 days or more', tone: 'kept' },
  { id: 'century', name: 'Century', how: 'Finish a challenge of 100 days or more', tone: 'kept' },
  { id: 'high-stakes', name: 'High stakes', how: 'Finish a challenge with $100 or more on it', tone: 'kept' },
  { id: 'in-the-open', name: 'In the open', how: 'Finish a public challenge', tone: 'kept' },
  { id: 'two-at-once', name: 'Two at once', how: 'Finish two challenges that ran at the same time', tone: 'kept' },
  { id: 'it-stuck', name: 'It stuck', how: 'Finish the same habit twice', tone: 'kept' },
  { id: 'well-rounded', name: 'Well rounded', how: 'Finish three different habits', tone: 'kept' },
  { id: 'first-fall', name: 'First fall', how: 'Don’t finish a challenge: the stake goes to charity', tone: 'fall' },
  { id: 'back-on-your-feet', name: 'Back on your feet', how: 'Finish a challenge after one you didn’t', tone: 'fall' },
  { id: 'close-call', name: 'Close call', how: 'Finish a challenge with both shields broken', tone: 'fall' },
  { id: 'unfinished-business', name: 'Unfinished business', how: 'Finish a habit you once didn’t', tone: 'fall' },
  { id: 'second-wind', name: 'Second wind', how: 'Finish a challenge with a bought shield', tone: 'fall' },
  { id: 'good-for-a-cause', name: 'Good for a cause', how: 'Give $100 of stakes to charity', tone: 'give' },
  { id: 'in-your-corner', name: 'In your corner', how: 'Back a friend’s challenge past Day 1', tone: 'give' },
  { id: 'always-there', name: 'Always there', how: 'Back five friends’ challenges past Day 1', tone: 'give' },
  { id: 'paying-it-forward', name: 'Paying it forward', how: 'Back a stranger’s challenge that finishes', tone: 'give' },
  // The hard ones: the Badges page shows only that they exist, and how rare, until they're earned.
  { id: 'ten-kept', name: 'Ten kept', how: 'Finish ten challenges', tone: 'kept', secret: true },
  { id: 'full-year', name: 'A full year', how: 'Finish a challenge of 365 days', tone: 'kept', secret: true },
  { id: 'clean-sweep', name: 'Clean sweep', how: 'Finish five challenges without missing a day', tone: 'kept', secret: true },
  { id: 'full-range', name: 'Full range', how: 'Finish six different habits', tone: 'kept', secret: true },
  { id: 'against-the-odds', name: 'Against the odds', how: 'Finish a challenge after buying all three revival shields', tone: 'fall', secret: true },
  { id: 'patron', name: 'Patron', how: 'Back five strangers’ challenges that finish', tone: 'give', secret: true },
];

/** Each badge by its id. */
export const BADGE_BY_ID = new Map(BADGES.map((b) => [b.id, b]));

/** At most this many badges lead a profile (decision 27). */
export const SHOWCASE_MAX = 3;

/** The badges that come from pledges, which a person's challenges can't show: counted by the server (badge_extras()). */
export type PledgeCounts = { backed?: number; supported?: number };

/** A badge someone has, the day it was earned (YYYY-MM-DD; null when unknown) and the challenge that earned it. */
export type EarnedBadge = { id: BadgeId; earnedOn: string | null; challengeId: string | null };

const DAY_MS = 86_400_000;
/** The calendar date of a challenge's day `day` (Day 1 is its start date). */
const dateOf = (c: ChallengeSummary, day: number) => new Date(Date.parse(`${c.startDate}T00:00:00Z`) + (day - 1) * DAY_MS).toISOString().slice(0, 10);
/** The date an ended challenge ended. */
const endedOn = (c: ChallengeSummary) => dateOf(c, c.endedOnDay ?? c.daysRequired);
/** Money was on it: past Day 1 (until then a challenge can be cancelled and everything comes back), never cancelled. */
const staked = (c: ChallengeSummary) => c.state === 'finished' || c.state === 'not_finished' || (c.state === 'active' && c.today > 1);
const byDate = <T extends { on: string }>(a: T, b: T) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0);

/**
 * The badges earned from these challenges and pledges (`backed`: strangers' challenges backed that
 * finished; `supported`: friends' challenges backed past Day 1), newest first.
 */
export function badgesFor(challenges: ChallengeSummary[], { backed = 0, supported = 0 }: PledgeCounts = {}): EarnedBadge[] {
  const counted = challenges.filter(staked);
  const ended = counted.filter((c) => c.state === 'finished' || c.state === 'not_finished').map((c) => ({ c, on: endedOn(c) })).sort(byDate);
  const finished = ended.filter((e) => e.c.state === 'finished');
  const falls = ended.filter((e) => e.c.state === 'not_finished');
  const earned: EarnedBadge[] = [];
  const add = (id: BadgeId, e: { c: ChallengeSummary; on: string } | undefined) => {
    if (e) earned.push({ id, earnedOn: e.on, challengeId: e.c.id });
  };

  add('first-step', counted.map((c) => ({ c, on: dateOf(c, 2) })).sort(byDate)[0]);
  add(
    'first-check-in',
    counted
      .flatMap((c) => c.days.filter((d) => d.status === 'approved' || d.status === 'excused').map((d) => ({ c, on: dateOf(c, d.day) })))
      .sort(byDate)[0],
  );
  add('kept-it', finished[0]);
  add('unbroken', finished.find((e) => e.c.missedDays.length === 0));
  add('hat-trick', finished[2]);
  add('long-haul', finished.find((e) => e.c.lengthDays >= 56));
  add('century', finished.find((e) => e.c.lengthDays >= 100));
  add('high-stakes', finished.find((e) => e.c.stakeDollars >= 100));
  add('in-the-open', finished.find((e) => e.c.isPublic));
  // Its partner ended on or after this one's Day 1: the two ran side by side.
  add('two-at-once', finished.find((e, i) => finished.slice(0, i).some((x) => x.on >= e.c.startDate)));
  add('it-stuck', finished.find((e, i) => finished.slice(0, i).some((x) => x.c.habitId === e.c.habitId)));
  const kinds = (n: number) => finished.find((_, i) => new Set(finished.slice(0, i + 1).map((x) => x.c.habitId)).size >= n);
  add('well-rounded', kinds(3));
  add('ten-kept', finished[9]);
  add('full-year', finished.find((e) => e.c.lengthDays >= 365));
  add('clean-sweep', finished.filter((e) => e.c.missedDays.length === 0)[4]);
  add('full-range', kinds(6));
  add('against-the-odds', finished.find((e) => e.c.boughtShields >= 3));
  add('first-fall', falls[0]);
  add('back-on-your-feet', falls[0] && finished.find((e) => e.on > falls[0].on));
  // Both starting shields broken: a finish on the edge (a bought shield counts too).
  add('close-call', finished.find((e) => e.c.missedDays.length >= 2));
  add('unfinished-business', finished.find((e) => falls.some((x) => x.c.habitId === e.c.habitId && x.on < e.on)));
  add('second-wind', finished.find((e) => e.c.boughtShields > 0));
  let given = 0;
  add('good-for-a-cause', falls.find((e) => (given += e.c.stakeDollars) >= 100));
  const undated = (id: BadgeId, has: boolean) => has && earned.push({ id, earnedOn: null, challengeId: null });
  undated('in-your-corner', supported >= 1);
  undated('always-there', supported >= 5);
  undated('paying-it-forward', backed >= 1);
  undated('patron', backed >= 5);

  return earned.sort((a, b) => (a.earnedOn === b.earnedOn ? 0 : a.earnedOn === null ? 1 : b.earnedOn === null ? -1 : a.earnedOn < b.earnedOn ? 1 : -1));
}

/** How close two counted badges are, for the Badges page's locked rows: "1 of 3 finished", "$35 of $100 so far". */
export function badgeProgress(challenges: ChallengeSummary[]): Partial<Record<BadgeId, string>> {
  const counted = challenges.filter(staked);
  const finished = counted.filter((c) => c.state === 'finished').length;
  const given = counted.filter((c) => c.state === 'not_finished').reduce((sum, c) => sum + c.stakeDollars, 0);
  return {
    'hat-trick': `${Math.min(finished, 3)} of 3 finished`,
    'good-for-a-cause': `$${Math.min(given, 100)} of $100 so far`,
  };
}

/** Each badge's share of Kept users, 0 to 1 (badge_shares()); a badge missing from it counts as common. */
export type Rarity = ReadonlyMap<string, number>;

/** Rarity from badge_shares()'s counts. */
export function rarityOf(shares: ReadonlyMap<string, { holders: number; users: number }> | null): Rarity | undefined {
  return shares ? new Map([...shares].map(([id, s]) => [id, s.users > 0 ? s.holders / s.users : 1])) : undefined;
}

/**
 * A profile's badges in showing order: the chosen showcase first, in the order picked (only badges
 * they really have, so a stale or forged choice shows nothing), then the rest, rarest first (owner,
 * 2026-10-03), so an unchosen showcase shows the hardest-won. Without shares, newest first.
 */
export function showcaseFirst(earned: EarnedBadge[], showcase: readonly string[], rarity?: Rarity): EarnedBadge[] {
  // Each id once: the database only limits the count, so a repeated id is possible.
  const chosen = [...new Set(showcase)].flatMap((id) => earned.filter((b) => b.id === id)).slice(0, SHOWCASE_MAX);
  const share = (b: EarnedBadge) => rarity?.get(b.id) ?? 1;
  // sort is stable, so equally rare badges keep their newest-first order.
  return [...chosen, ...earned.filter((b) => !chosen.includes(b)).sort((a, b) => share(a) - share(b))];
}

/** Whether the profile could show more chosen badges than it does: your profile then invites choosing. */
export function canChooseMore(earned: EarnedBadge[], showcase: readonly string[]): boolean {
  const chosen = [...new Set(showcase)].filter((id) => earned.some((b) => b.id === id)).length;
  return chosen < Math.min(SHOWCASE_MAX, earned.length);
}

/** Adds a badge to the showcase or takes it off; 'full' when three are already showing. */
export function toggleShowcase(showcase: readonly string[], id: BadgeId): string[] | 'full' {
  if (showcase.includes(id)) return showcase.filter((x) => x !== id);
  return showcase.length >= SHOWCASE_MAX ? 'full' : [...showcase, id];
}

/** A badge's share of Kept users, like Steam's achievements: "9.5% of Kept users". */
export function shareText(holders: number, users: number): string {
  if (users <= 0 || holders <= 0) return 'No one has it yet';
  const percent = Number(((holders / users) * 100).toFixed(1));
  return percent > 0 ? `${percent}% of Kept users` : 'Under 0.1% of Kept users';
}

/**
 * The badges an ending earned, for its results screen: this challenge's, dated the day it ended, not
 * the ones it earned on the way (First step on Day 2, First check-in).
 */
export function endingBadges(earned: EarnedBadge[], c: ChallengeSummary): EarnedBadge[] {
  const on = endedOn(c);
  return earned.filter((b) => b.challengeId === c.id && b.earnedOn === on);
}
