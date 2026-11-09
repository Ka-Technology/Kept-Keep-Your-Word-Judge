// Pins the badges' rules (owner, 2026-10-02 and 2026-10-03; the "Badges" boards on the brand canvas):
// earned only on staked challenges and pledges, each on the day its challenge decided it; the
// showcase; each badge's share of users; and that the SQL twin (migration 0042) lists every badge.

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { badgeProgress, badgesFor, BADGES, canChooseMore, endingBadges, rarityOf, shareText, showcaseFirst, toggleShowcase, type EarnedBadge } from './badges';
import type { ChallengeSummary } from './challenges';

const challenge = (over: Partial<ChallengeSummary>): ChallengeSummary => ({
  id: 'c', habitId: 'read', title: 'Read', charityName: 'Oceana', stakeDollars: 35, paymentName: 'Card', isPublic: false, lengthDays: 28,
  startDate: '2026-09-01', timeZone: 'UTC', today: 30, daysCompleted: 28, daysRequired: 28, shieldsLeft: 2, shieldsTotal: 2, missedDays: [],
  boughtShields: 0, revival: null, underReview: false, state: 'finished', endedOnDay: 28, quit: false, checkedInToday: false, todayText: null, days: [],
  ...over,
});
const ids = (cs: ChallengeSummary[], backed = 0) => badgesFor(cs, { backed }).map((b) => b.id).sort();

describe('badgesFor (who has earned what)', () => {
  it('earns nothing without a staked challenge past Day 1', () => {
    expect(badgesFor([])).toEqual([]);
    expect(ids([challenge({ state: 'cancelled', endedOnDay: 1 }), challenge({ state: 'upcoming', today: 0 }), challenge({ state: 'active', today: 1 })])).toEqual([]);
  });

  it('gives First step once a challenge is past Day 1, and First check-in on its first approved day', () => {
    const running = challenge({ state: 'active', today: 4, endedOnDay: null, days: [{ day: 2, status: 'approved', text: 'Approved' }] });
    const earned = badgesFor([running]);
    expect(earned.map((b) => b.id).sort()).toEqual(['first-check-in', 'first-step']);
    expect(earned.find((b) => b.id === 'first-step')?.earnedOn).toBe('2026-09-02');
    expect(earned.find((b) => b.id === 'first-check-in')?.earnedOn).toBe('2026-09-02');
  });

  it('gives Kept it and Unbroken for a finish without a missed day', () => {
    expect(ids([challenge({})])).toEqual(['first-step', 'kept-it', 'unbroken']);
  });

  it('gives Second wind and Close call, not Unbroken, for a finish with a bought shield', () => {
    const revived = challenge({ endedOnDay: 31, missedDays: [{ day: 3, boughtCents: null }, { day: 9, boughtCents: null }, { day: 15, boughtCents: 700 }], boughtShields: 1 });
    expect(ids([revived])).toEqual(['close-call', 'first-step', 'kept-it', 'second-wind']);
  });

  it('gives Hat trick on the day the third challenge finishes', () => {
    const three = ['2026-01-01', '2026-03-01', '2026-05-01'].map((startDate, i) => challenge({ id: `c${i}`, startDate, missedDays: [{ day: 5, boughtCents: null }] }));
    expect(badgesFor(three).find((b) => b.id === 'hat-trick')).toEqual({ id: 'hat-trick', earnedOn: '2026-05-28', challengeId: 'c2' });
    expect(ids(three.slice(0, 2))).not.toContain('hat-trick');
  });

  it('gives Long haul for finishing 56 days or more', () => {
    expect(ids([challenge({ lengthDays: 56, daysRequired: 56, endedOnDay: 56 })])).toContain('long-haul');
    expect(ids([challenge({ lengthDays: 42, daysRequired: 42, endedOnDay: 42 })])).not.toContain('long-haul');
  });

  it('gives First fall for a challenge not finished, and Back on your feet for a finish after it', () => {
    const fall = challenge({ id: 'fall', state: 'not_finished', startDate: '2026-01-01', endedOnDay: 12 });
    const later = challenge({ id: 'later', habitId: 'cook', startDate: '2026-02-01' });
    expect(ids([fall, later])).toEqual(['back-on-your-feet', 'first-fall', 'first-step', 'kept-it', 'unbroken']);
    const earlier = challenge({ id: 'earlier', startDate: '2025-11-01' });
    expect(ids([earlier, fall])).not.toContain('back-on-your-feet');
  });

  it('gives Good for a cause once $100 of stakes went to charity', () => {
    const a = challenge({ id: 'a', state: 'not_finished', stakeDollars: 60, startDate: '2026-01-01', endedOnDay: 10 });
    const b = challenge({ id: 'b', state: 'not_finished', stakeDollars: 45, startDate: '2026-03-01', endedOnDay: 7 });
    expect(badgesFor([a, b]).find((x) => x.id === 'good-for-a-cause')).toEqual({ id: 'good-for-a-cause', earnedOn: '2026-03-07', challengeId: 'b' });
    expect(ids([a])).not.toContain('good-for-a-cause');
  });

  it('gives Paying it forward and In your corner from the pledge counts, with no date of their own', () => {
    expect(badgesFor([], { backed: 1 })).toEqual([{ id: 'paying-it-forward', earnedOn: null, challengeId: null }]);
    expect(badgesFor([], { supported: 2 })).toEqual([{ id: 'in-your-corner', earnedOn: null, challengeId: null }]);
  });

  it('gives Always there for five friends backed, and the secret Patron for five strangers backed to a finish', () => {
    expect(badgesFor([], { supported: 5, backed: 5 }).map((b) => b.id).sort()).toEqual(['always-there', 'in-your-corner', 'patron', 'paying-it-forward']);
    expect(badgesFor([], { supported: 4, backed: 4 }).map((b) => b.id).sort()).toEqual(['in-your-corner', 'paying-it-forward']);
  });

  it('gives Century, High stakes and In the open for what a finish had on it', () => {
    expect(ids([challenge({ lengthDays: 100, daysRequired: 100, endedOnDay: 100 })])).toContain('century');
    expect(ids([challenge({ lengthDays: 99, daysRequired: 99, endedOnDay: 99 })])).not.toContain('century');
    expect(ids([challenge({ stakeDollars: 100 })])).toContain('high-stakes');
    expect(ids([challenge({ stakeDollars: 99 })])).not.toContain('high-stakes');
    expect(ids([challenge({ isPublic: true })])).toContain('in-the-open');
    expect(ids([challenge({ isPublic: true, state: 'not_finished', endedOnDay: 9 })])).not.toContain('in-the-open');
  });

  it('gives Two at once for two finishes that ran side by side, not one after the other', () => {
    const a = challenge({ id: 'a', habitId: 'read', startDate: '2026-01-01' });
    expect(badgesFor([a, challenge({ id: 'b', habitId: 'cook', startDate: '2026-01-20' })]).find((x) => x.id === 'two-at-once')?.challengeId).toBe('b');
    expect(ids([a, challenge({ id: 'c', habitId: 'cook', startDate: '2026-02-01' })])).not.toContain('two-at-once');
  });

  it('gives the secret Clean sweep, Full range and Against the odds for the hard finishes', () => {
    const habits = ['read', 'cook', 'journal', 'study', 'stretch', 'meditate'];
    const six = habits.map((habitId, i) => challenge({ id: habitId, habitId, startDate: `2025-${String(i + 1).padStart(2, '0')}-01` }));
    expect(ids(six)).toEqual(expect.arrayContaining(['clean-sweep', 'full-range']));
    expect(badgesFor(six).find((b) => b.id === 'clean-sweep')?.challengeId).toBe('stretch');
    expect(ids(six.slice(0, 4))).not.toContain('clean-sweep');
    expect(ids(six.slice(0, 5))).not.toContain('full-range');
    expect(ids([challenge({ boughtShields: 3, endedOnDay: 33 })])).toContain('against-the-odds');
    expect(ids([challenge({ boughtShields: 2, endedOnDay: 32 })])).not.toContain('against-the-odds');
  });

  it('keeps the hard ones secret: Ten kept, A full year, Clean sweep, Full range, Against the odds and Patron', () => {
    expect(BADGES.filter((b) => b.secret).map((b) => b.id).sort()).toEqual(['against-the-odds', 'clean-sweep', 'full-range', 'full-year', 'patron', 'ten-kept']);
  });

  it('gives It stuck on the second finish of the same habit, and Well rounded on the third different one', () => {
    const at = (id: string, habitId: string, startDate: string) => challenge({ id, habitId, startDate, missedDays: [{ day: 4, boughtCents: null }] });
    const cs = [at('a', 'read', '2026-01-01'), at('b', 'cook', '2026-02-01'), at('c', 'read', '2026-03-01'), at('d', 'journal', '2026-04-01')];
    const earned = badgesFor(cs);
    expect(earned.find((b) => b.id === 'it-stuck')).toEqual({ id: 'it-stuck', earnedOn: '2026-03-28', challengeId: 'c' });
    expect(earned.find((b) => b.id === 'well-rounded')).toEqual({ id: 'well-rounded', earnedOn: '2026-04-28', challengeId: 'd' });
    expect(ids(cs.slice(0, 2))).not.toContain('it-stuck');
    expect(ids(cs.slice(0, 3))).not.toContain('well-rounded');
  });

  it('gives Ten kept on the tenth finish and A full year for 365 days', () => {
    const ten = Array.from({ length: 10 }, (_, i) => challenge({ id: `c${i}`, startDate: `2025-${String(i + 1).padStart(2, '0')}-01` }));
    expect(badgesFor(ten).find((b) => b.id === 'ten-kept')?.challengeId).toBe('c9');
    expect(ids(ten.slice(1))).not.toContain('ten-kept');
    expect(ids([challenge({ lengthDays: 365, daysRequired: 365, endedOnDay: 365 })])).toContain('full-year');
    expect(ids([challenge({ lengthDays: 364, daysRequired: 364, endedOnDay: 364 })])).not.toContain('full-year');
  });

  it('gives Close call for a finish with both shields broken, not one', () => {
    const missed = (n: number) => Array.from({ length: n }, (_, i) => ({ day: i + 2, boughtCents: null }));
    expect(ids([challenge({ endedOnDay: 30, missedDays: missed(2) })])).toContain('close-call');
    expect(ids([challenge({ endedOnDay: 29, missedDays: missed(1) })])).not.toContain('close-call');
  });

  it('gives Unfinished business for finishing a habit after not finishing it, never the other way round', () => {
    const fall = challenge({ id: 'fall', state: 'not_finished', startDate: '2026-01-01', endedOnDay: 12 });
    expect(badgesFor([fall, challenge({ id: 'again', startDate: '2026-02-01' })]).find((b) => b.id === 'unfinished-business')?.challengeId).toBe('again');
    expect(ids([fall, challenge({ id: 'other', habitId: 'cook', startDate: '2026-02-01' })])).not.toContain('unfinished-business');
    expect(ids([challenge({ id: 'before', startDate: '2025-11-01' }), fall])).not.toContain('unfinished-business');
  });

  it('lists the newest first, undated ones last', () => {
    const fall = challenge({ id: 'fall', state: 'not_finished', startDate: '2026-01-01', endedOnDay: 12 });
    const later = challenge({ id: 'later', startDate: '2026-02-01' });
    const order = badgesFor([fall, later], { backed: 2 }).map((b) => b.earnedOn);
    expect(order).toEqual([...order.filter(Boolean).sort().reverse(), null]);
  });
});

describe('badgeProgress (how close a locked badge is)', () => {
  it('counts finishes toward Hat trick and charity dollars toward Good for a cause, never toward a secret one', () => {
    const progress = badgeProgress([challenge({}), challenge({ id: 'f', state: 'not_finished', stakeDollars: 35, endedOnDay: 9 })]);
    expect(progress['hat-trick']).toBe('1 of 3 finished');
    expect(Object.keys(progress).filter((id) => BADGES.find((b) => b.id === id)?.secret)).toEqual([]);
    expect(progress['good-for-a-cause']).toBe('$35 of $100 so far');
  });
});

describe('the showcase (decision 27)', () => {
  const earned = ['unbroken', 'kept-it', 'first-step'].map((id) => ({ id, earnedOn: '2026-09-01', challengeId: 'c' })) as EarnedBadge[];

  it('puts the chosen badges first, in the order picked, and skips ones they don’t have', () => {
    expect(showcaseFirst(earned, ['first-step', 'hat-trick', 'kept-it']).map((b) => b.id)).toEqual(['first-step', 'kept-it', 'unbroken']);
    expect(showcaseFirst(earned, [])).toEqual(earned);
  });

  it('shows the rarest next when fewer than three are chosen, and invites choosing', () => {
    const rarity = rarityOf(new Map([['kept-it', { holders: 1, users: 100 }], ['first-step', { holders: 80, users: 100 }], ['unbroken', { holders: 5, users: 100 }]]));
    expect(showcaseFirst(earned, [], rarity).map((b) => b.id)).toEqual(['kept-it', 'unbroken', 'first-step']);
    expect(showcaseFirst(earned, ['first-step'], rarity).map((b) => b.id)).toEqual(['first-step', 'kept-it', 'unbroken']);
    expect(canChooseMore(earned, ['first-step'])).toBe(true);
    expect(canChooseMore(earned, ['first-step', 'kept-it', 'unbroken'])).toBe(false);
    expect(canChooseMore(earned.slice(0, 1), ['unbroken'])).toBe(false);
    expect(canChooseMore([], [])).toBe(false);
  });

  it('adds and removes, up to three', () => {
    expect(toggleShowcase([], 'kept-it')).toEqual(['kept-it']);
    expect(toggleShowcase(['kept-it', 'unbroken'], 'kept-it')).toEqual(['unbroken']);
    expect(toggleShowcase(['a', 'b', 'c'], 'kept-it')).toBe('full');
  });
});

describe('shareText (each badge’s share of Kept users)', () => {
  it('reads like Steam’s achievements, to one decimal', () => {
    expect(shareText(19, 200)).toBe('9.5% of Kept users');
    expect(shareText(1, 3)).toBe('33.3% of Kept users');
    expect(shareText(4, 4)).toBe('100% of Kept users');
    expect(shareText(0, 4)).toBe('No one has it yet');
    // Held, but too rare to round to 0.1%: never "0% of Kept users".
    expect(shareText(1, 2001)).toBe('Under 0.1% of Kept users');
  });
});

describe('badge_shares(), the SQL twin', () => {
  it('lists every badge in the newest migration that defines it', () => {
    const dir = join(__dirname, '../../supabase/migrations');
    const newest = readdirSync(dir).sort().filter((f) => readFileSync(join(dir, f), 'utf8').includes('function public.badge_shares()')).pop()!;
    const sql = readFileSync(join(dir, newest), 'utf8');
    // The list it reports is exactly Kept's badges…
    const listed = sql.slice(sql.indexOf('unnest(array['), sql.indexOf(']) as b(id)'));
    expect([...listed.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort()).toEqual(BADGES.map((x) => x.id).sort());
    // …and each has a rule counting its holders, not just a place in the list.
    const rules = sql.slice(sql.indexOf('held (user_id, badge_id)'), sql.indexOf('unnest(array['));
    for (const x of BADGES) expect(rules).toContain(`'${x.id}'`);
  });
});

describe('a showcase with a repeated id (the database allows one)', () => {
  const earned = ['kept-it', 'unbroken'].map((id) => ({ id, earnedOn: '2026-09-01', challengeId: 'c' })) as EarnedBadge[];

  it('shows the badge once', () => {
    expect(showcaseFirst(earned, ['kept-it', 'kept-it']).map((b) => b.id)).toEqual(['kept-it', 'unbroken']);
  });

  it('counts it once when inviting more', () => {
    expect(canChooseMore(earned, ['kept-it', 'kept-it'])).toBe(true);
  });
});

describe('endingBadges (what a results screen calls new)', () => {
  it('shows what the ending earned, not what the challenge earned on the way', () => {
    const first = challenge({ id: 'first', days: [{ day: 1, status: 'approved', text: 'Approved' }] });
    expect(endingBadges(badgesFor([first]), first).map((b) => b.id).sort()).toEqual(['kept-it', 'unbroken']);
  });
});
