// Pins the pledge rules the app shows (SPEC-pledges.md decisions 4 and 5, T31): the limits, when a
// pledge can be withdrawn, what became of a stake or pledge, and database errors as plain sentences.
// migration 0022's triggers enforce the same numbers, proven by supabase/tests/pledges_rls.sql.

import { summarizeChallenge } from './challenges';
import {
  BACKER_WINDOW_DAYS,
  backHeading,
  backerCreditsText,
  KEPT_CREDITS_EXPLAINED,
  matchesDiscover,
  pledgerProfile,
  backerBadgeText,
  canMakePublic,
  canWithdrawPledge,
  creditBalanceCents,
  donationDetail,
  donationState,
  donationsTotalCents,
  walletTotals,
  publicChallengeRow,
  giftError,
  giftErrorMessage,
  GIFT_LIMITS,
  pendingPledgeCents,
  PLEDGE_LIMITS,
  challengeFull,
  challengeRoomText,
  pledgeError,
  pledgeErrorMessage,
  bankFromText,
  explorerUrl,
  solanaPayoutText,
  keptBalanceRow,
  moneyBackDetail,
  takebackLabel,
  moneyBackLabel,
  pledgeFate,
  pledgeSummaryText,
  stakeFate,
} from './pledges';

describe('Your donations in Wallet (T62)', () => {
  it('says what each donation came from, and on which habit', () => {
    expect(donationDetail('stake', 'Read')).toBe('Your stake on Read');
    expect(donationDetail('pledge', 'Learn a language (Korean)')).toBe('Your pledge on Learn a language (Korean)');
    expect(donationDetail('gift', 'Work out')).toBe('Your extra gift on Work out');
  });

  it('says where each donation stands: on its way until Kept gives it, then the day it was given', () => {
    expect(donationState({ status: 'owed', given_on: null })).toBe('On its way');
    expect(donationState({ status: 'given', given_on: '2026-12-01' })).toBe('Given Dec 1 by Kept');
    expect(donationState({ status: 'given', given_on: '2027-01-31' })).toBe('Given Jan 31 by Kept');
  });

  it('never calls a donation given without its day', () => {
    expect(donationState({ status: 'given', given_on: null })).toBe('On its way');
  });

  it('adds up every donation, to the cent', () => {
    expect(donationsTotalCents([{ amount_cents: 3500 }, { amount_cents: 2500 }, { amount_cents: 150 }])).toBe(6150);
    expect(donationsTotalCents([])).toBe(0);
  });
});

describe('PLEDGE_LIMITS', () => {
  it('are the owner’s numbers: $5 to $100 a pledge, $300 pending per person, $1,000 per challenge', () => {
    expect(PLEDGE_LIMITS).toEqual({ minDollars: 5, maxDollars: 100, outstandingMaxDollars: 300, challengeMaxDollars: 1000 });
  });
});

describe('pledgeError', () => {
  const fresh = { currentDollars: 0, outstandingCents: 0 };

  it('accepts whole dollars from $5 to $100', () => {
    expect(pledgeError(5, fresh)).toBeNull();
    expect(pledgeError(100, fresh)).toBeNull();
  });

  it('refuses a missing amount, under $5 and over $100', () => {
    expect(pledgeError(null, fresh)).toBe('Enter an amount in whole dollars, like 25.');
    expect(pledgeError(4, fresh)).toBe('The smallest pledge is $5.');
    expect(pledgeError(101, fresh)).toBe('A pledge can be up to $100.');
  });

  it('only raises an existing pledge', () => {
    expect(pledgeError(25, { currentDollars: 25, outstandingCents: 2500 })).toBe('You can only raise a pledge: enter more than $25.');
    expect(pledgeError(30, { currentDollars: 25, outstandingCents: 2500 })).toBeNull();
  });

  it('keeps the pledger’s pending pledges within $300, counting a raise as the difference', () => {
    expect(pledgeError(60, { currentDollars: 0, outstandingCents: 25000 })).toBe(
      'You have $250 pledged on challenges that haven’t ended, and the total can be up to $300. You can pledge up to $50 now.',
    );
    expect(pledgeError(50, { currentDollars: 0, outstandingCents: 25000 })).toBeNull();
    // Raising a $40 pledge to $90 adds $50 to the $250 already pending (which includes the $40).
    expect(pledgeError(90, { currentDollars: 40, outstandingCents: 25000 })).toBeNull();
    expect(pledgeError(95, { currentDollars: 40, outstandingCents: 25000 })).toMatch(/total can be up to \$300/);
  });

  it('tells someone raising a pledge how far it can go, or that it can’t go further', () => {
    expect(pledgeError(95, { currentDollars: 40, outstandingCents: 25000 })).toMatch(/You can pledge up to \$90 now\.$/);
    expect(pledgeError(45, { currentDollars: 40, outstandingCents: 30000 })).toMatch(/Wait for one to end before pledging again\.$/);
  });

  it('says when nothing more can be pledged', () => {
    expect(pledgeError(5, { currentDollars: 0, outstandingCents: 29800 })).toBe(
      'You have $298 pledged on challenges that haven’t ended, and the total can be up to $300. Wait for one to end before pledging again.',
    );
  });
});

describe('the $1,000 a challenge can take (decision 155)', () => {
  it('takes a pledge that brings it to $1,000 exactly, and refuses one dollar past', () => {
    expect(pledgeError(5, { currentDollars: 0, outstandingCents: 0, challengeTotalCents: 99500 })).toBeNull();
    expect(pledgeError(6, { currentDollars: 0, outstandingCents: 0, challengeTotalCents: 99500 })).toBe(
      'This challenge can take $5 more in pledges, so you can pledge up to $5.',
    );
  });

  it('limits a raise to the room left, counting it as the difference', () => {
    expect(pledgeError(50, { currentDollars: 40, outstandingCents: 4000, challengeTotalCents: 99000 })).toBeNull();
    expect(pledgeError(51, { currentDollars: 40, outstandingCents: 4000, challengeTotalCents: 99000 })).toBe(
      'This challenge can take $10 more in pledges, so you can raise yours up to $50.',
    );
  });

  it('is full for a new pledge under $5 of room, and for a raise with none', () => {
    expect(challengeFull(99600, false)).toBe(true);
    expect(challengeFull(99500, false)).toBe(false);
    expect(challengeFull(99900, true)).toBe(false);
    expect(challengeFull(100000, true)).toBe(true);
  });

  it('says how much room is left, or that it’s full', () => {
    expect(challengeRoomText(15000, false)).toBe('It can take $850 more.');
    expect(challengeRoomText(0, false)).toBe('It can take $1,000 more.');
    expect(challengeRoomText(99600, false)).toBe('This challenge is full: a challenge can take up to $1,000 in pledges.');
    expect(challengeRoomText(99600, true)).toBe('It can take $4 more.');
  });

  it('explains the crypto pledge refusals (T171)', () => {
    expect(pledgeErrorMessage({ code: 'P0001', message: 'pledge_payment_waiting' })).toBe(
      'Your wallet may still be sending your last payment. Try again in a few minutes.',
    );
    expect(pledgeErrorMessage({ code: 'P0001', message: 'pledge_crypto_challenge_only' })).toBe(
      'Only a challenge paid in crypto takes crypto pledges. Pay by card instead.',
    );
  });

  it('says so when the database refuses a pledge past it', () => {
    expect(pledgeErrorMessage({ code: 'P0001', message: 'pledge_challenge_full' })).toBe(
      'This challenge is full: a challenge can take up to $1,000 in pledges.',
    );
  });
});

describe('canWithdrawPledge (until the end of Day 1)', () => {
  it('allows it before Day 1 and on Day 1', () => {
    expect(canWithdrawPledge({ state: 'upcoming', today: 0 })).toBe(true);
    expect(canWithdrawPledge({ state: 'active', today: 1 })).toBe(true);
  });

  it('refuses it from Day 2, and once the challenge has ended', () => {
    expect(canWithdrawPledge({ state: 'active', today: 2 })).toBe(false);
    expect(canWithdrawPledge({ state: 'not_finished', today: 1 })).toBe(false);
    expect(canWithdrawPledge({ state: 'finished', today: 1 })).toBe(false);
  });
});

describe('pendingPledgeCents', () => {
  it('adds up pledges on challenges that haven’t ended, and nothing else', () => {
    expect(
      pendingPledgeCents([
        { amount_cents: 2500, outcome: null },
        { amount_cents: 4000, outcome: null },
        { amount_cents: 10000, outcome: 'finished' },
        { amount_cents: 500, outcome: 'not_finished' },
      ]),
    ).toBe(6500);
    expect(pendingPledgeCents([])).toBe(0);
  });
});

describe('pledgeSummaryText', () => {
  it('reads naturally for none, one and several pledgers', () => {
    expect(pledgeSummaryText({ totalCents: 0, pledgers: 0 })).toBe('No pledges yet');
    expect(pledgeSummaryText({ totalCents: 2500, pledgers: 1 })).toBe('1 person has pledged $25');
    expect(pledgeSummaryText({ totalCents: 5000, pledgers: 2 })).toBe('2 people have pledged $50');
  });
});

describe('what became of a stake or a pledge (Wallet)', () => {
  const fate = (outcome: 'finished' | 'not_finished' | 'cancelled' | null, donate: boolean, toCharity = false) => ({
    outcome,
    donate_if_not_finished: donate,
    to_charity_on_finish: toCharity,
    charity: 'Oceana',
  });

  it('a stake: pending while running, back on finishing, to the charity otherwise', () => {
    expect(stakeFate(null, 'charity: water')).toBe('Staked, challenge running');
    expect(stakeFate('finished', 'charity: water')).toBe('Came back to you');
    expect(stakeFate('not_finished', 'charity: water')).toBe('Went to charity: water');
  });

  it('a cancelled challenge (T52): the stake and every pledge came back', () => {
    expect(stakeFate('cancelled', 'Oceana')).toBe('Came back to you (cancelled)');
    expect(pledgeFate(fate('cancelled', true, true))).toBe('Came back to you (cancelled)');
  });

  it('a pledge: the challenger’s reward on finishing unless the charity was chosen; back on failure unless the pledger chose to donate', () => {
    expect(pledgeFate(fate(null, false))).toBe('Pledged, challenge running');
    expect(pledgeFate(fate('finished', false))).toBe('Went to the challenger, as their reward');
    expect(pledgeFate(fate('finished', true, true))).toBe('Went to Oceana');
    expect(pledgeFate(fate('not_finished', false))).toBe('Came back to you');
    expect(pledgeFate(fate('not_finished', true))).toBe('Went to Oceana');
  });
});

describe('moneyBackLabel (Wallet’s money coming back, T189)', () => {
  it('names a reward, a stake back and a pledge back', () => {
    expect(moneyBackLabel({ kind: 'reward', source: 'pledge', habit: 'Work out' })).toBe('Your reward: Work out');
    expect(moneyBackLabel({ kind: 'return', source: 'stake', habit: 'Read' })).toBe('Your stake back: Read');
    expect(moneyBackLabel({ kind: 'return', source: 'pledge', habit: 'Journal' })).toBe('Your pledge back: Journal');
  });
});

describe('crypto coming back to a wallet (T170)', () => {
  const back = { kind: 'return' as const, status: 'confirmed' as const };

  it('says where the stake is, and that a donation waits for its charity', () => {
    expect(solanaPayoutText(back, 'ASPCA')).toBe('Back to your wallet');
    expect(solanaPayoutText({ kind: 'return', status: 'due' }, 'ASPCA')).toBe('On its way to your wallet');
    expect(solanaPayoutText({ kind: 'reward', status: 'sent' }, 'ASPCA')).toBe('On its way to your wallet');
    expect(solanaPayoutText({ kind: 'donation', status: 'due' }, 'ASPCA')).toBe('Going to ASPCA');
    expect(solanaPayoutText({ kind: 'return', status: 'failed' }, 'ASPCA')).toBe('Couldn’t reach your wallet yet. Kept is looking into it');
  });

  it('links a transaction on Solscan, on the cluster it’s on', () => {
    expect(explorerUrl('5abc', 'devnet')).toBe('https://solscan.io/tx/5abc?cluster=devnet');
    expect(explorerUrl('5abc', 'mainnet')).toBe('https://solscan.io/tx/5abc');
  });

  it('links an account on Solscan too: a stake’s escrow (T231)', () => {
    expect(explorerUrl('2JFy', 'devnet', 'address')).toBe('https://solscan.io/account/2JFy?cluster=devnet');
    expect(explorerUrl('2JFy', 'mainnet', 'address')).toBe('https://solscan.io/account/2JFy');
  });
});

describe('the 14-day wait on a reward (T195, decision 154)', () => {
  it('says when a reward can go to a bank, in the person’s own time zone', () => {
    expect(bankFromText('2026-11-11T18:00:00Z', 'America/Los_Angeles')).toBe('Can go to your bank from Nov 11');
    expect(bankFromText('2026-11-11T18:00:00Z', 'Asia/Seoul')).toBe('Can go to your bank from Nov 12');
  });
});

describe('Kept balance after a take-back (T194, decision 153)', () => {
  it('shows a balance as it is', () => {
    expect(keptBalanceRow(2500)).toEqual({ value: '$25' });
    expect(keptBalanceRow(0)).toEqual({ value: '$0' });
  });

  it('shows what’s owed below zero, and where it comes from', () => {
    expect(keptBalanceRow(-2550)).toEqual({
      value: '−$25.50',
      detail: 'Owed: a pledge in your reward was taken back by its bank. It comes out of the next money you get in Kept.',
    });
  });

  it('names each take-back by its habit, never by who pledged', () => {
    expect(takebackLabel('Work out')).toBe('A pledge on Work out was taken back by its bank');
  });
});

describe('moneyBackDetail (decision 158: a return nobody chooses for goes back after 14 days)', () => {
  it('says when a return goes back to its card on its own', () => {
    expect(moneyBackDetail({ kind: 'return', created_at: '2026-10-28T18:00:00Z' }, 'America/Los_Angeles')).toBe(
      'Choose where it goes, or it goes back to your card on Nov 11',
    );
  });

  it('dates it in the person’s own time zone', () => {
    expect(moneyBackDetail({ kind: 'return', created_at: '2026-10-28T23:30:00Z' }, 'Asia/Seoul')).toBe(
      'Choose where it goes, or it goes back to your card on Nov 12',
    );
  });

  it('asks only for a choice otherwise', () => {
    expect(moneyBackDetail({ kind: 'reward', created_at: '2026-10-28T18:00:00Z' }, 'America/Los_Angeles')).toBe('Choose where it goes');
  });
});

describe('pledgeErrorMessage', () => {
  it('turns each database refusal into a plain sentence', () => {
    expect(pledgeErrorMessage({ code: 'P0001', message: 'pledge_not_friend' })).toBe('Only friends can back this challenge.');
    expect(pledgeErrorMessage({ code: 'P0001', message: 'pledge_backer_window' })).toBe(
      'Backers can pledge only in a challenge’s first 7 days.',
    );
    expect(pledgeErrorMessage({ code: 'P0001', message: 'pledge_own_challenge' })).toBe('You can’t back your own challenge.');
    expect(pledgeErrorMessage({ code: 'P0001', message: 'pledge_challenge_ended' })).toBe('This challenge has ended, so it can’t take pledges.');
    expect(pledgeErrorMessage({ code: 'P0001', message: 'pledge_outstanding_limit' })).toBe(
      'Your pledges on challenges that haven’t ended can be up to $300 in total.',
    );
    expect(pledgeErrorMessage({ code: 'P0001', message: 'pledge_only_raise' })).toBe('You can only raise a pledge, not lower it.');
    expect(pledgeErrorMessage({ code: 'withdraw', message: 'pledge_not_withdrawable' })).toBe(
      'Pledges can be withdrawn only until the end of Day 1.',
    );
    expect(pledgeErrorMessage({ code: '23505', message: 'duplicate key' })).toBe('You’ve already backed this challenge. You can raise your pledge.');
    expect(pledgeErrorMessage({ code: 'P0001', message: 'pledge_not_allowed' })).toBe('You can’t back this challenge.');
    expect(pledgeErrorMessage({ code: '23514', message: 'pledges_amount_cents_check' })).toBe('Pledges are whole dollars from $5 to $100.');
  });

  it('falls back to a connection message or a general one, never the raw error', () => {
    expect(pledgeErrorMessage({})).toBe('Couldn’t reach Kept. Check your connection and try again.');
    expect(pledgeErrorMessage({ code: 'XX000', message: 'boom' })).toBe('Kept couldn’t save your pledge. Please try again.');
  });
});

describe('extra gifts at the end (SPEC-pledges.md decision 11)', () => {
  it('are whole dollars from $1 to $100', () => {
    expect(GIFT_LIMITS).toEqual({ minDollars: 1, maxDollars: 100 });
    expect(giftError(1, 0)).toBeNull();
    expect(giftError(100, 0)).toBeNull();
    expect(giftError(null, 0)).toBe('Enter an amount in whole dollars, like 10.');
    expect(giftError(0, 0)).toBe('The smallest gift is $1.');
    expect(giftError(101, 0)).toBe('A gift can be up to $100.');
  });

  it('can only be raised once given', () => {
    expect(giftError(10, 10)).toBe('You can only raise a gift: enter more than $10.');
    expect(giftError(15, 10)).toBeNull();
  });

  it('turns database refusals into plain sentences', () => {
    expect(giftErrorMessage({ code: 'P0001', message: 'gift_challenge_running' })).toBe('Gifts can be added once the challenge has ended.');
    expect(giftErrorMessage({ code: 'P0001', message: 'gift_not_allowed' })).toBe('Only the challenger and people who pledged can add a gift.');
    expect(giftErrorMessage({ code: 'P0001', message: 'gift_only_raise' })).toBe('You can only raise a gift, not lower it.');
    expect(giftErrorMessage({ code: '23505', message: 'duplicate key' })).toBe('You’ve already given. You can raise your gift.');
    expect(giftErrorMessage({ code: '23514', message: 'extra_gifts_amount_cents_check' })).toBe('Gifts are whole dollars from $1 to $100.');
    expect(giftErrorMessage({})).toBe('Couldn’t reach Kept. Check your connection and try again.');
    expect(giftErrorMessage({ code: 'XX000', message: 'boom' })).toBe('Kept couldn’t save your gift. Please try again.');
  });
});

describe('Kept credits, explained (T209)', () => {
  it('says what credits are, how they’re earned and capped, and that they aren’t money', () => {
    expect(KEPT_CREDITS_EXPLAINED).toMatch(/10% of your pledge, never more than the service fee you paid on it/);
    expect(KEPT_CREDITS_EXPLAINED).toMatch(/Backing a friend earns none/);
    expect(KEPT_CREDITS_EXPLAINED).toMatch(/pay Kept’s service fee/);
    expect(KEPT_CREDITS_EXPLAINED).toMatch(/aren’t money/);
  });

  it('tells a backer what this pledge would earn, not a percentage that the cap breaks', () => {
    // $25: 10% is $2.50, but the fee on $25 is $2.25, so credits stop there.
    expect(backerCreditsText('the challenger', 2500)).toBe('As a backer, you’d earn $2.25 in Kept credits if the challenger finishes.');
    expect(backerCreditsText('sam', 1000)).toBe('As a backer, you’d earn $1 in Kept credits if sam finishes.');
  });

  it('gives the rule until an amount is chosen', () => {
    expect(backerCreditsText('the challenger', null)).toBe(
      'As a backer, you earn Kept credits if the challenger finishes: 10% of your pledge, never more than its service fee.',
    );
  });
});

describe('matchesDiscover (Discover’s search; T206)', () => {
  const friend = { habit: 'Practice an instrument', charity: 'Doctors Without Borders', username: 'sam.k' };
  const stranger = { habit: 'Read', charity: 'Oceana' };

  it('shows everything until something is typed', () => {
    expect(matchesDiscover('', stranger)).toBe(true);
    expect(matchesDiscover('   ', friend)).toBe(true);
  });

  it('matches the habit, the charity or a friend’s username, in any case', () => {
    expect(matchesDiscover('instrument', friend)).toBe(true);
    expect(matchesDiscover('DOCTORS', friend)).toBe(true);
    expect(matchesDiscover('sam', friend)).toBe(true);
    expect(matchesDiscover(' ocean ', stranger)).toBe(true);
    expect(matchesDiscover('chess', friend)).toBe(false);
  });

  it('takes a username typed with its @', () => {
    expect(matchesDiscover('@sam.k', friend)).toBe(true);
    expect(matchesDiscover('@sam', stranger)).toBe(false);
  });
});

describe('backHeading (the pledge screen’s title; T205)', () => {
  it('asks to back a running challenge, by name for a friend', () => {
    expect(backHeading({ running: true, known: 'sam', isFriend: true, pledged: false })).toEqual({ title: 'Back @sam' });
    expect(backHeading({ running: true, isFriend: false, pledged: false })).toEqual({ title: 'Back this challenge', subtitle: 'A public challenge' });
    expect(backHeading({ running: true, isFriend: true, pledged: false })).toEqual({ title: 'Back this challenge', subtitle: 'A friend’s challenge' });
  });

  it('says an ended challenge has ended, and that it can’t be backed, instead of asking', () => {
    expect(backHeading({ running: false, isFriend: false, pledged: false })).toEqual({
      title: 'This challenge has ended',
      subtitle: 'It can’t be backed any more.',
    });
  });

  it('tells a pledger whose challenge it was once it has ended', () => {
    expect(backHeading({ running: false, known: 'sam', isFriend: true, pledged: true })).toEqual({ title: 'This challenge has ended', subtitle: '@sam’s challenge' });
    expect(backHeading({ running: false, isFriend: false, pledged: true })).toEqual({ title: 'This challenge has ended', subtitle: 'One you backed' });
  });
});

describe('public challenges (SPEC-pledges.md decisions 3, 6 and 7; T44)', () => {
  it('backers can pledge in the first 7 days, so a challenge can be made public until then', () => {
    expect(BACKER_WINDOW_DAYS).toBe(7);
    expect(canMakePublic({ state: 'upcoming', today: 0 })).toBe(true);
    expect(canMakePublic({ state: 'active', today: 7 })).toBe(true);
    expect(canMakePublic({ state: 'active', today: 8 })).toBe(false);
    expect(canMakePublic({ state: 'finished', today: 3 })).toBe(false);
  });

  it('a Discover row summarizes like any challenge, with no stake or way to pay', () => {
    const row = publicChallengeRow({
      id: 'c1', habit_id: 'read', habit: 'Read', language: null, level: null,
      length_days: 28, start_date: '2026-09-01', time_zone: 'UTC', day_offset: 0, charity: 'Oceana',
      check_ins: [{ day: 1, status: 'approved' }, { day: 2, status: 'rejected' }, { day: 3, status: 'approved' }], total_cents: 3000, pledgers: 2,
    });
    const c = summarizeChallenge(row, new Date('2026-09-04T12:00:00Z'));
    expect(c).toMatchObject({ title: 'Read', charityName: 'Oceana', today: 4, shieldsLeft: 1, stakeDollars: 0, state: 'active' });
  });

  it('a Discover row carries its bought shields, so a backer sees which missed day was bought back (0039)', () => {
    const row = publicChallengeRow({
      id: 'c1', habit_id: 'read', habit: 'Read', language: null, level: null,
      length_days: 28, start_date: '2026-09-01', time_zone: 'UTC', day_offset: 0, charity: 'Oceana',
      check_ins: [], shield_purchases: [{ day: 3, price_cents: 700 }], total_cents: 0, pledgers: 0,
    });
    const c = summarizeChallenge({ ...row, stake_cents: 3500 }, new Date('2026-09-05T12:00:00Z'));
    expect(c.missedDays.at(-1)).toEqual({ day: 4, boughtCents: null });
    expect(c.missedDays.find((d) => d.day === 3)).toEqual({ day: 3, boughtCents: 700 });
  });
});

describe('creditBalanceCents (Wallet)', () => {
  it('adds up credits from backer pledges on finished challenges only', () => {
    expect(
      creditBalanceCents([
        { kind: 'backer', amount_cents: 2500, outcome: 'finished' },
        { kind: 'backer', amount_cents: 1000, outcome: 'not_finished' },
        { kind: 'backer', amount_cents: 5000, outcome: null },
        { kind: 'supporter', amount_cents: 10000, outcome: 'finished' },
        { kind: 'backer', amount_cents: 500, outcome: 'finished' },
      ]),
    ).toBe(275);
  });
});

describe('backerBadgeText (SPEC-pledges.md decision 10)', () => {
  it('names the count of finished challenges backed', () => {
    expect(backerBadgeText(1)).toBe('Backed 1 finished challenge');
    expect(backerBadgeText(3)).toBe('Backed 3 finished challenges');
  });
});

describe('walletTotals (Wallet’s three numbers, owner 2026-09-27)', () => {
  it('adds up what’s staked on running challenges, the credits earned, and what’s pledged on running ones', () => {
    const stakes = [
      { state: 'active' as const, stakeDollars: 25 },
      { state: 'upcoming' as const, stakeDollars: 10 },
      { state: 'finished' as const, stakeDollars: 100 },
      { state: 'cancelled' as const, stakeDollars: 40 },
    ];
    const pledges = [
      { kind: 'backer' as const, amount_cents: 2500, outcome: 'finished' as const },
      { kind: 'supporter' as const, amount_cents: 4000, outcome: null },
      { kind: 'backer' as const, amount_cents: 1000, outcome: null },
    ];
    expect(walletTotals(stakes, pledges)).toEqual({ stakedCents: 3500, creditsCents: 225, pledgedCents: 5000 });
  });
});

describe('pledgerProfile (what tapping someone in "Who’s backing you" opens)', () => {
  const pledge = (over: Partial<{ kind: 'supporter' | 'backer'; username: string | null; backer: string | null }>) => ({
    kind: 'supporter' as const, username: 'ruthie.k', avatar_path: null, backer: null, amount_cents: 2500, donate_if_not_finished: false, to_charity_on_finish: false, ...over,
  });
  const friends = [
    { friendship_id: 'f1', user_id: 'u-ruthie', username: 'ruthie.k', avatar_path: null, status: 'accepted' as const, direction: 'outgoing' as const },
    { friendship_id: 'f2', user_id: 'u-sam', username: 'sam', avatar_path: null, status: 'pending' as const, direction: 'incoming' as const },
  ];

  it('opens a friend’s profile', () => {
    expect(pledgerProfile(pledge({}), friends)).toEqual({ kind: 'friend', userId: 'u-ruthie' });
  });

  it('shows a preview of a supporter who isn’t a friend now', () => {
    expect(pledgerProfile(pledge({ username: 'sam' }), friends)).toEqual({ kind: 'preview', username: 'sam' });
    expect(pledgerProfile(pledge({ username: 'gone' }), [])).toEqual({ kind: 'preview', username: 'gone' });
  });

  it('keeps a backer anonymous', () => {
    expect(pledgerProfile(pledge({ kind: 'backer', username: null, backer: 'Backer A' }), friends)).toEqual({ kind: 'anonymous' });
  });
});
