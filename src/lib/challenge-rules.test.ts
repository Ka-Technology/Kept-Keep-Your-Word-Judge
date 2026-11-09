// Unit tests for challenge-rules.ts: every challenge rule in SPEC-challenges.md (days, shields,
// ending, settlement, the example fee and the completion rate). Each rule has a test that fails
// if the rule breaks.
import {
  CREDIT_RATES,
  creditsFor,
  chargeFor,
  creditsOnFee,
  donations,
  feeBreakdown,
  MAX_BOUGHT_SHIELDS,
  payouts,
  pledgeDonated,
  pledgeRewards,
  progress,
  serviceFeeCents,
  settle,
  SHIELDS,
  shieldPriceCents,
  shieldSplit,
  type ChallengeFacts,
  type CheckInStatus,
} from './challenge-rules';

/** A 28-day, $35 challenge whose days 1..n have the given statuses (null = no check-in). */
function facts(statuses: (CheckInStatus | null)[], lengthDays = 28): ChallengeFacts {
  return {
    lengthDays,
    stakeCents: 3500,
    checkIns: statuses.flatMap((status, i) => (status ? [{ day: i + 1, status }] : [])),
  };
}

const approved = (n: number): CheckInStatus[] => Array(n).fill('approved');

describe('progress: shields and length', () => {
  it('starts with 2 shields and nothing completed (owner, 2026-10-01)', () => {
    expect(SHIELDS).toBe(2);
    expect(progress(facts([]), 1)).toEqual({
      daysCompleted: 0,
      misses: 0,
      shieldsLeft: 2,
      daysRequired: 28,
      outcome: 'active',
      endedOnDay: null,
      underReview: false,
    });
  });

  it('is active, not ended, before the challenge starts', () => {
    expect(progress(facts([]), 0).outcome).toBe('active');
  });

  it('finishes on day 28 with no misses', () => {
    const result = progress(facts(approved(28)), 29);
    expect(result).toMatchObject({ daysCompleted: 28, misses: 0, shieldsLeft: 2, outcome: 'finished', endedOnDay: 28 });
  });

  it('finishes on the last day as soon as it is approved, without waiting for midnight', () => {
    expect(progress(facts(approved(28)), 28)).toMatchObject({ outcome: 'finished', endedOnDay: 28 });
  });

  it.each([1, 2])('survives %i missed day(s): each breaks a shield and adds a day', (missCount) => {
    const statuses: (CheckInStatus | null)[] = [...Array(missCount).fill(null), ...approved(28)];
    const today = 28 + missCount + 1;
    expect(progress(facts(statuses), today)).toMatchObject({
      daysCompleted: 28,
      misses: missCount,
      shieldsLeft: 2 - missCount,
      daysRequired: 28 + missCount,
      outcome: 'finished',
      endedOnDay: 28 + missCount,
    });
  });

  it('is still active after 28 calendar days if one was missed', () => {
    const statuses = [null, ...approved(27)];
    expect(progress(facts(statuses), 29)).toMatchObject({ daysCompleted: 27, misses: 1, daysRequired: 29, outcome: 'active' });
  });

  it('keeps running with no shields left: 2 misses leave 0 shields, not an ending', () => {
    expect(progress(facts([null, null]), 3)).toMatchObject({ misses: 2, shieldsLeft: 0, outcome: 'active' });
  });

  it('ends as not finished on the day of the third miss, a miss with no shield left', () => {
    const statuses = ['approved', null, 'approved', null, 'approved', null] as (CheckInStatus | null)[];
    expect(progress(facts(statuses), 7)).toMatchObject({
      daysCompleted: 3,
      misses: 3,
      shieldsLeft: 0,
      outcome: 'not_finished',
      endedOnDay: 6,
    });
  });

  it('counts nothing after the third miss', () => {
    const statuses = [null, null, null, ...approved(30)];
    expect(progress(facts(statuses), 40)).toMatchObject({ daysCompleted: 0, misses: 3, outcome: 'not_finished', endedOnDay: 3 });
  });

  it('uses the chosen length, any number of days from 28', () => {
    expect(progress(facts(approved(45), 45), 46)).toMatchObject({ outcome: 'finished', endedOnDay: 45, daysRequired: 45 });
    expect(progress(facts(approved(45), 60), 46)).toMatchObject({ outcome: 'active', daysRequired: 60 });
  });
});

describe('progress: revival shields (owner, 2026-10-01)', () => {
  const threeMisses = ['approved', null, 'approved', null, 'approved', null] as (CheckInStatus | null)[];

  it('a bought shield absorbs the miss that ended the challenge, and it runs on', () => {
    expect(progress({ ...facts(threeMisses), shields: SHIELDS + 1 }, 7)).toMatchObject({ misses: 3, shieldsLeft: 0, outcome: 'active', daysRequired: 31 });
  });

  it('the next miss with none left ends it again', () => {
    expect(progress({ ...facts([...threeMisses, null]), shields: SHIELDS + 1 }, 8)).toMatchObject({ misses: 4, outcome: 'not_finished', endedOnDay: 7 });
  });

  it('a revived challenge still finishes on its length', () => {
    expect(progress({ ...facts([...threeMisses, ...approved(25)]), shields: SHIELDS + 1 }, 32)).toMatchObject({ daysCompleted: 28, outcome: 'finished', endedOnDay: 31 });
  });

  it('allows up to 3 bought shields', () => {
    expect(MAX_BOUGHT_SHIELDS).toBe(3);
  });

  it('costs 20%, 40%, then 60% of the stake, whole dollars rounded up, at least $5', () => {
    expect([1, 2, 3].map((n) => shieldPriceCents(3500, n))).toEqual([700, 1400, 2100]);
    expect([1, 2, 3].map((n) => shieldPriceCents(1000, n))).toEqual([500, 500, 600]);
    expect(shieldPriceCents(3700, 1)).toBe(800); // $7.40 rounds up to $8
  });

  it('splits half to the charity and half to Kept, to the cent', () => {
    expect(shieldSplit(700)).toEqual({ charityCents: 350, keptCents: 350 });
  });
});

describe('progress: underReview (a finish waits for its days to be decided)', () => {
  it('is true while a day counted as done is still being checked', () => {
    expect(progress(facts([...approved(27), 'pending']), 29)).toMatchObject({ outcome: 'finished', underReview: true });
  });

  it('is false once every counted day is decided', () => {
    expect(progress(facts(approved(28)), 29).underReview).toBe(false);
  });
});

describe('progress: what counts as done or missed', () => {
  it('counts an excused day (a Kept error, or an upheld appeal) as done', () => {
    expect(progress(facts(['excused']), 2)).toMatchObject({ daysCompleted: 1, misses: 0 });
  });

  it('counts a check-in still pending when its day ends as done (checking it was Kept’s job)', () => {
    expect(progress(facts(['pending']), 2)).toMatchObject({ daysCompleted: 1, misses: 0 });
  });

  it('counts a rejected check-in as a miss', () => {
    expect(progress(facts(['rejected']), 2)).toMatchObject({ daysCompleted: 0, misses: 1, shieldsLeft: 1 });
  });

  it('counts a day that ended with no check-in as a miss', () => {
    expect(progress(facts([null]), 2)).toMatchObject({ misses: 1 });
  });

  it('leaves today open: no check-in, pending or rejected is not a miss until the day ends', () => {
    for (const today of [null, 'pending', 'rejected'] as (CheckInStatus | null)[]) {
      expect(progress(facts([today]), 1)).toMatchObject({ daysCompleted: 0, misses: 0 });
    }
  });

  it('counts today as done as soon as it is approved or excused', () => {
    expect(progress(facts(['approved']), 1).daysCompleted).toBe(1);
    expect(progress(facts(['excused']), 1).daysCompleted).toBe(1);
  });

  // SPEC-verification.md's statuses (T25).
  it('counts a check-in still being checked when its day ends as done: flagged, with the AI, or waiting for a retake', () => {
    for (const status of ['flagged', 'ai_checking', 'retake'] as CheckInStatus[]) {
      expect(progress(facts([status]), 2)).toMatchObject({ daysCompleted: 1, misses: 0 });
    }
  });

  it('leaves today open while it is being checked', () => {
    for (const status of ['flagged', 'ai_checking', 'retake', 'appealed'] as CheckInStatus[]) {
      expect(progress(facts([status]), 1)).toMatchObject({ daysCompleted: 0, misses: 0 });
    }
  });

  it('counts an appealed day as a miss until the owner restores it', () => {
    expect(progress(facts(['appealed']), 2)).toMatchObject({ daysCompleted: 0, misses: 1, shieldsLeft: 1 });
  });
});

describe('settle', () => {
  const challenge = facts(approved(28));
  const pledges = [
    { kind: 'supporter' as const, amountCents: 2500, donateIfNotFinished: false },
    { kind: 'supporter' as const, amountCents: 2500, donateIfNotFinished: false },
  ];

  it('returns the stake and gives every pledge to the challenger as their reward when they finish (v2 worked example, decision 143)', () => {
    expect(settle(challenge, 'finished', { pledges })).toEqual({
      stakeToChallengerCents: 3500,
      stakeToCharityCents: 0,
      pledgesToCharityCents: 0,
      pledgesToChallengerCents: 5000,
      pledgesRefundedCents: 0,
      extraGivingToCharityCents: 0,
      shieldsToCharityCents: 0,
      shieldsToKeptCents: 0,
      charityTotalCents: 0,
      serviceFeeCents: 255,
      creditsCents: [0, 0],
    });
  });

  it('gives a pledge to the charity on a finish when its pledger chose the charity over the reward', () => {
    const mixed = [{ ...pledges[0], toCharityOnFinish: true }, pledges[1]];
    expect(settle(challenge, 'finished', { pledges: mixed })).toMatchObject({
      pledgesToCharityCents: 2500,
      pledgesToChallengerCents: 2500,
      pledgesRefundedCents: 0,
      charityTotalCents: 2500,
    });
  });

  it('gives the stake to the charity and refunds the pledges when the challenger does not finish', () => {
    expect(settle(challenge, 'not_finished', { pledges })).toEqual({
      stakeToChallengerCents: 0,
      stakeToCharityCents: 3500,
      pledgesToCharityCents: 0,
      pledgesToChallengerCents: 0,
      pledgesRefundedCents: 5000,
      extraGivingToCharityCents: 0,
      shieldsToCharityCents: 0,
      shieldsToKeptCents: 0,
      charityTotalCents: 3500,
      serviceFeeCents: 255,
      creditsCents: [0, 0],
    });
  });

  it('gives a pledge to the charity anyway when that supporter chose to donate', () => {
    const mixed = [
      { kind: 'supporter' as const, amountCents: 2500, donateIfNotFinished: true },
      { kind: 'supporter' as const, amountCents: 1000, donateIfNotFinished: false },
    ];
    expect(settle(challenge, 'not_finished', { pledges: mixed })).toMatchObject({
      pledgesToCharityCents: 2500,
      pledgesRefundedCents: 1000,
      charityTotalCents: 6000,
    });
  });

  it('adds optional extra giving to the charity in either outcome', () => {
    expect(settle(challenge, 'finished', { extraGivingCents: 1000 })).toMatchObject({
      extraGivingToCharityCents: 1000,
      charityTotalCents: 1000,
    });
    expect(settle(challenge, 'not_finished', { extraGivingCents: 1000 }).charityTotalCents).toBe(4500);
  });

  it('sends the charity its half of revival shields whatever the ending; Kept keeps the other half', () => {
    expect(settle(challenge, 'finished', { shieldsCents: 2100 })).toMatchObject({ shieldsToCharityCents: 1050, shieldsToKeptCents: 1050, charityTotalCents: 1050 });
    expect(settle(challenge, 'not_finished', { shieldsCents: 700 }).charityTotalCents).toBe(3850);
  });

  it.each(['finished', 'not_finished', 'cancelled'] as const)('accounts for every dollar that came in, and keeps the fee separate (%s)', (outcome) => {
    const mixed = [{ ...pledges[0], toCharityOnFinish: true, donateIfNotFinished: true }, pledges[1]];
    const result = settle(challenge, outcome, { pledges: mixed });
    // Everything that came in (stake + pledges) goes back, to the finisher or to the charity; the fee is on top.
    expect(result.stakeToChallengerCents + result.stakeToCharityCents).toBe(3500);
    expect(result.pledgesToCharityCents + result.pledgesToChallengerCents + result.pledgesRefundedCents).toBe(5000);
  });
});

describe('settle a cancelled challenge (T52: cancelled until the end of Day 1)', () => {
  const challenge = facts([]);
  const pledges = [
    { kind: 'supporter' as const, amountCents: 2500, donateIfNotFinished: true },
    { kind: 'backer' as const, amountCents: 1000, donateIfNotFinished: false },
  ];

  it('returns the stake and every pledge, even one set to donate either way; the fee is kept', () => {
    expect(settle(challenge, 'cancelled', { pledges })).toEqual({
      stakeToChallengerCents: 3500,
      stakeToCharityCents: 0,
      pledgesToCharityCents: 0,
      pledgesToChallengerCents: 0,
      pledgesRefundedCents: 3500,
      extraGivingToCharityCents: 0,
      shieldsToCharityCents: 0,
      shieldsToKeptCents: 0,
      charityTotalCents: 0,
      serviceFeeCents: 255,
      creditsCents: [0, 0],
    });
  });
});

describe('donations: the donation route, per giver (T61)', () => {
  const pledges = [
    { giver: 'ben', kind: 'supporter' as const, amountCents: 2500, donateIfNotFinished: false },
    { giver: 'cara', kind: 'supporter' as const, amountCents: 2500, donateIfNotFinished: false },
  ];

  it('gives nothing when the challenger finishes: the pledges are their reward (v2 worked example, decision 143)', () => {
    expect(donations(3500, 'finished', { challenger: 'ana', pledges })).toEqual([]);
  });

  it('gives a pledge in its pledger’s name on a finish when they chose the charity', () => {
    const chosen = [{ ...pledges[0], toCharityOnFinish: true }, pledges[1]];
    expect(donations(3500, 'finished', { challenger: 'ana', pledges: chosen })).toEqual([{ giver: 'ben', source: 'pledge', amountCents: 2500 }]);
  });

  it('gives the stake in the challenger’s name, and no refunded pledge, when they don’t finish', () => {
    expect(donations(3500, 'not_finished', { challenger: 'ana', pledges })).toEqual([{ giver: 'ana', source: 'stake', amountCents: 3500 }]);
  });

  it('gives a pledge anyway when its pledger chose to donate, and every extra gift in its giver’s name', () => {
    const mixed = [{ ...pledges[0], donateIfNotFinished: true }, pledges[1]];
    const gifts = [
      { giver: 'ana', amountCents: 1000 },
      { giver: 'cara', amountCents: 500 },
    ];
    expect(donations(3500, 'not_finished', { challenger: 'ana', pledges: mixed, gifts })).toEqual([
      { giver: 'ana', source: 'stake', amountCents: 3500 },
      { giver: 'ben', source: 'pledge', amountCents: 2500 },
      { giver: 'ana', source: 'gift', amountCents: 1000 },
      { giver: 'cara', source: 'gift', amountCents: 500 },
    ]);
  });

  it('gives nothing from a cancelled challenge, even a pledge set to donate either way', () => {
    const anyway = [{ ...pledges[0], donateIfNotFinished: true }];
    expect(donations(3500, 'cancelled', { challenger: 'ana', pledges: anyway })).toEqual([]);
  });

  it.each(['finished', 'not_finished', 'cancelled'] as const)('always adds up to what settle() sends the charity (%s)', (outcome) => {
    const mixed = [{ ...pledges[0], donateIfNotFinished: true, toCharityOnFinish: true }, pledges[1]];
    const gifts = [{ giver: 'ana', amountCents: 1000 }];
    const total = donations(3500, outcome, { challenger: 'ana', pledges: mixed, gifts, shieldsCents: 2100 }).reduce((sum, d) => sum + d.amountCents, 0);
    expect(total).toBe(settle(facts([]), outcome, { pledges: mixed, extraGivingCents: 1000, shieldsCents: 2100 }).charityTotalCents);
  });

  it('gives the charity’s half of bought shields in the challenger’s name', () => {
    expect(donations(3500, 'finished', { challenger: 'ana', shieldsCents: 700 })).toEqual([{ giver: 'ana', source: 'shield', amountCents: 350 }]);
  });
});

describe('pledgeDonated and pledgeRewards', () => {
  it('sends a pledge to the charity on a finish or a failure only if chosen, and never on a cancel', () => {
    expect(pledgeDonated({ donateIfNotFinished: false }, 'finished')).toBe(false);
    expect(pledgeDonated({ donateIfNotFinished: false, toCharityOnFinish: true }, 'finished')).toBe(true);
    expect(pledgeDonated({ donateIfNotFinished: false }, 'not_finished')).toBe(false);
    expect(pledgeDonated({ donateIfNotFinished: true }, 'not_finished')).toBe(true);
    expect(pledgeDonated({ donateIfNotFinished: true, toCharityOnFinish: true }, 'cancelled')).toBe(false);
  });

  it('rewards the challenger with a pledge only on a finish, unless its pledger chose the charity', () => {
    expect(pledgeRewards({ donateIfNotFinished: true }, 'finished')).toBe(true);
    expect(pledgeRewards({ donateIfNotFinished: false, toCharityOnFinish: true }, 'finished')).toBe(false);
    expect(pledgeRewards({ donateIfNotFinished: false }, 'not_finished')).toBe(false);
    expect(pledgeRewards({ donateIfNotFinished: false }, 'cancelled')).toBe(false);
  });
});

describe('payouts: money back, and the finisher’s reward (T188, decision 143)', () => {
  const pledges = [
    { giver: 'ben', kind: 'supporter' as const, amountCents: 2500, donateIfNotFinished: false },
    { giver: 'cara', kind: 'backer' as const, amountCents: 2500, donateIfNotFinished: false },
  ];

  it('returns the stake and pays each pledge to the finisher (v2 worked example)', () => {
    expect(payouts(3500, 'finished', { challenger: 'ana', pledges })).toEqual([
      { to: 'ana', giver: 'ana', source: 'stake', kind: 'return', amountCents: 3500 },
      { to: 'ana', giver: 'ben', source: 'pledge', kind: 'reward', amountCents: 2500 },
      { to: 'ana', giver: 'cara', source: 'pledge', kind: 'reward', amountCents: 2500 },
    ]);
  });

  it('pays nothing for a pledge its pledger chose to give to the charity on a finish', () => {
    const chosen = [{ ...pledges[0], toCharityOnFinish: true }, pledges[1]];
    expect(payouts(3500, 'finished', { challenger: 'ana', pledges: chosen }).map((p) => `${p.giver} ${p.kind}`)).toEqual(['ana return', 'cara reward']);
  });

  it('returns each pledge to its pledger on a failure, unless donated, and keeps the stake for the charity', () => {
    const anyway = [{ ...pledges[0], donateIfNotFinished: true }, pledges[1]];
    expect(payouts(3500, 'not_finished', { challenger: 'ana', pledges: anyway })).toEqual([{ to: 'cara', giver: 'cara', source: 'pledge', kind: 'return', amountCents: 2500 }]);
  });

  it('returns everything on a cancel, even a pledge set to donate either way', () => {
    const anyway = [{ ...pledges[0], donateIfNotFinished: true, toCharityOnFinish: true }, pledges[1]];
    expect(payouts(3500, 'cancelled', { challenger: 'ana', pledges: anyway }).map((p) => `${p.to} ${p.amountCents}`)).toEqual(['ana 3500', 'ben 2500', 'cara 2500']);
  });

  it.each(['finished', 'not_finished', 'cancelled'] as const)('with donations(), accounts for the whole stake and every pledge (%s)', (outcome) => {
    const mixed = [{ ...pledges[0], donateIfNotFinished: true, toCharityOnFinish: true }, pledges[1]];
    const out = payouts(3500, outcome, { challenger: 'ana', pledges: mixed }).reduce((sum, p) => sum + p.amountCents, 0);
    const given = donations(3500, outcome, { challenger: 'ana', pledges: mixed }).reduce((sum, d) => sum + d.amountCents, 0);
    expect(out + given).toBe(3500 + 5000);
  });
});

describe('Kept credits (SPEC-pledges.md decision 9, T45)', () => {
  const challenge = facts(approved(28));
  const backed = [
    { kind: 'supporter' as const, amountCents: 2500, donateIfNotFinished: false },
    { kind: 'backer' as const, amountCents: 2500, donateIfNotFinished: false },
    { kind: 'backer' as const, amountCents: 500, donateIfNotFinished: true },
  ];

  it('live in one place: supporters 0%, backers 10%', () => {
    expect(CREDIT_RATES).toEqual({ supporter: 0, backer: 0.1 });
  });

  it('are earned by backers only, and only when the challenger finishes', () => {
    expect(settle(challenge, 'finished', { pledges: backed }).creditsCents).toEqual([0, 225, 50]);
    expect(settle(challenge, 'not_finished', { pledges: backed }).creditsCents).toEqual([0, 0, 0]);
  });

  it('never change where the money goes: credits come from Kept’s fee, not from anyone’s pledge', () => {
    const result = settle(challenge, 'finished', { pledges: backed });
    expect(result.pledgesToChallengerCents).toBe(5500);
    expect(result.pledgesRefundedCents).toBe(0);
  });

  it('creditsFor rounds down to the cent and gives nothing on failure or to a supporter', () => {
    expect(creditsFor('backer', 2500, 'finished')).toBe(225); // 10% is $2.50, capped at the $2.25 fee
    expect(creditsFor('backer', 10000, 'finished')).toBe(450); // a $100 pledge: $10 capped at $4.50
    expect(creditsFor('backer', 2500, 'not_finished')).toBe(0);
    expect(creditsFor('backer', 2500, null)).toBe(0);
    expect(creditsFor('supporter', 2500, 'finished')).toBe(0);
  });
});

describe('creditsOnFee: Kept credits pay the fee, never more (T164)', () => {
  it('pays all of the fee when there are enough credits, part of it otherwise, and nothing with none', () => {
    expect(creditsOnFee(225, 525)).toBe(225);
    expect(creditsOnFee(225, 135)).toBe(135);
    expect(creditsOnFee(225, 0)).toBe(0);
    expect(creditsOnFee(225, -50)).toBe(0);
  });
});

describe('chargeFor: Kept balance first, then the fee on what the card pays (T189)', () => {
  it('lets a balance pay all of it with no fee, or part of it with the fee on the card’s part only', () => {
    expect(chargeFor(3500, 255, { balanceLeftCents: 5000 })).toEqual({ balanceCents: 3500, feeCents: 0, creditsCents: 0, totalCents: 0 });
    expect(chargeFor(3000, 240, { balanceLeftCents: 1500 })).toEqual({ balanceCents: 1500, feeCents: 195, creditsCents: 0, totalCents: 1695 });
  });

  it('takes credits off what fee is left, and never leaves the card under Stripe’s 50¢ minimum', () => {
    expect(chargeFor(2500, 225, { creditsLeftCents: 100 })).toEqual({ balanceCents: 0, feeCents: 225, creditsCents: 100, totalCents: 2625 });
    // $24.80 from the balance leaves 20¢ for the card plus a $1.51 fee: credits pay only down to 50¢.
    expect(chargeFor(2500, 225, { balanceLeftCents: 2480, creditsLeftCents: 1000 })).toEqual({ balanceCents: 2480, feeCents: 151, creditsCents: 121, totalCents: 50 });
  });
});

describe('feeBreakdown: the fee on top of a stake or pledge (T63)', () => {
  it('charges the amount plus the fee, never the amount minus it ($10 → $11.80)', () => {
    expect(feeBreakdown(1000)).toEqual({ amountCents: 1000, feeCents: 180, totalCents: 1180 });
    expect(feeBreakdown(3500)).toEqual({ amountCents: 3500, feeCents: 255, totalCents: 3755 });
  });

  it('charges a raise only the difference: $10 → $25 adds $15 and 45¢ of fee, not a second $1.50', () => {
    expect(feeBreakdown(2500).totalCents - feeBreakdown(1000).totalCents).toBe(1545);
  });

  it('adds no fee to a raise past the $9.99 cap: $283 → $300 adds just the $17', () => {
    expect(feeBreakdown(30000).totalCents - feeBreakdown(28300).totalCents).toBe(1700);
  });
});

describe('serviceFeeCents ($1.50 + 3% of the amount, capped at $9.99; owner, 2026-10-27, decision 146)', () => {
  it.each([
    [100, 153],
    [1000, 180],
    [3500, 255],
    [10000, 450],
    [20000, 750],
    [28200, 996],
    [28300, 999],
    [30000, 999],
  ])('charges %i¢ stake a %i¢ fee', (stake, fee) => {
    expect(serviceFeeCents(stake)).toBe(fee);
  });
});
