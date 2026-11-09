/// <reference types="node" />
// Unit tests for challenges.ts: the create-a-challenge checks that mirror migration 0004, the start
// date, and turning database errors into plain sentences.
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  amountAt,
  habitGroup,
  pastMoney,
  deletionBlockedMessage,
  DELETION_BLOCKED_MESSAGE,
  MONEY_IN_KEPT_MESSAGE,
  moneyInKeptMessage,
  challengeErrorMessage,
  checkInErrorMessage,
  completionRateText,
  contractText,
  defaultSolanaToken,
  demoClockCanMove,
  demoClockEnabled,
  donationRoute,
  duplicateChallengeError,
  feeLines,
  raiseText,
  finishShieldsLine,
  meStats,
  outcomeUpdate,
  money,
  settlementLines,
  cancelOrQuit,
  shieldsLabel,
  speechLanguage,
  stampDays,
  stampWindow,
  summarizeChallenge,
  type ChallengeRow,
  type ChallengeSummary,
  LANGUAGES,
  LENGTH_LIMITS,
  lengthError,
  weeksLabel,
  LEVELS,
  parseWholeNumber,
  parseStakeDollars,
  PAYMENT_METHODS,
  paymentNameFor,
  solanaPayEnabled,
  solanaPayLink,
  stakeContext,
  stakeError,
  startDate,
  STAKE_LIMITS,
  finishedText,
  missedDayText,
  shieldErrorMessage,
} from './challenges';

describe('Solana stakes from a wallet (T169)', () => {
  it('are collected only in builds with EXPO_PUBLIC_SOLANA_PAY', () => {
    expect(solanaPayEnabled(undefined)).toBe(false);
    expect(solanaPayEnabled('')).toBe(false);
    expect(solanaPayEnabled('devnet')).toBe(true);
  });

  it('open the wallet on a Solana Pay transaction request, its URL encoded', () => {
    expect(solanaPayLink('c1', 'https://x.supabase.co')).toBe('solana:https%3A%2F%2Fx.supabase.co%2Ffunctions%2Fv1%2Fsolana-pay%3Fchallenge%3Dc1');
  });

  it('open the wallet on a crypto pledge’s payment by its own id (T171)', () => {
    expect(solanaPayLink('p1', 'https://x.supabase.co', 'payment')).toBe('solana:https%3A%2F%2Fx.supabase.co%2Ffunctions%2Fv1%2Fsolana-pay%3Fpayment%3Dp1');
  });

  it('pick Kept’s own test USDT first on devnet, which Kept tops up so a tester needs no faucet (T222)', () => {
    expect(defaultSolanaToken('devnet')).toBe('USDT');
    expect(defaultSolanaToken(undefined)).toBe('USDC');
    expect(defaultSolanaToken('mainnet')).toBe('USDC');
  });

  it('name the token picked, and fall back to the demo’s USDC', () => {
    expect(paymentNameFor('solana_usdc', 'PYUSD')).toBe('Solana (PYUSD)');
    expect(paymentNameFor('solana_usdc', null)).toBe('Solana (USDC)');
    expect(paymentNameFor('card', null)).toBe('Card');
  });
});

describe('the app mirrors the challenges migrations (0004, and 0005 for the length)', () => {
  const read = (file: string) => readFileSync(join(__dirname, '../../supabase/migrations', file), 'utf8');
  const migration = read('0004_challenges.sql');
  const quoted = (codes: readonly { code: string }[]) => codes.map((c) => `'${c.code}'`).join(', ');

  it('uses the same minimum, first-challenge cap and total cap (in cents; 0006 has the current trigger)', () => {
    const stakes = read('0006_stake_limits.sql');
    expect(stakes).toContain(`new.stake_cents < ${STAKE_LIMITS.minDollars * 100}`);
    expect(stakes).toContain(`new.stake_cents > ${STAKE_LIMITS.firstChallengeMaxDollars * 100}`);
    expect(stakes).toContain(`outstanding + new.stake_cents > ${STAKE_LIMITS.outstandingMaxDollars * 100}`);
  });

  it('refuses a second running challenge for the same habit (and language) in the insert trigger', () => {
    const rule = read('0007_one_challenge_per_habit.sql');
    expect(rule).toContain('habit_id = new.habit_id and language is not distinct from new.language');
    expect(rule).toContain("raise exception 'duplicate_challenge'");
  });

  it('allows the same lengths, languages, levels and ways to pay', () => {
    expect(read('0005_challenge_length.sql')).toContain(
      `check (length_days between ${LENGTH_LIMITS.minDays} and ${LENGTH_LIMITS.maxDays})`,
    );
    expect(migration).toContain(`language in (${quoted(LANGUAGES)})`);
    expect(migration).toContain(`level in (${quoted(LEVELS)})`);
    expect(migration).toContain(`payment_method in (${quoted(PAYMENT_METHODS)})`);
  });
});

describe('speechLanguage (the voice for a quiz’s listening question; T42)', () => {
  it('gives every language a BCP 47 code for expo-speech', () => {
    expect(speechLanguage('spanish')).toBe('es-ES');
    expect(speechLanguage('mandarin')).toBe('zh-CN');
    expect(LANGUAGES.every((l) => /^[a-z]{2}-[A-Z]{2}$/.test(speechLanguage(l.code) ?? ''))).toBe(true);
  });
});

describe('parseWholeNumber', () => {
  it('reads a whole number, ignoring surrounding spaces', () => {
    expect(parseWholeNumber(' 45 ')).toBe(45);
  });

  it.each(['', '4.5', 'forty', '-3'])('rejects %p', (text) => {
    expect(parseWholeNumber(text)).toBeNull();
  });
});

describe('weeksLabel (How many days, in weeks; T213)', () => {
  it('says whole weeks plainly', () => {
    expect(weeksLabel(28)).toBe('4 weeks');
    expect(weeksLabel(56)).toBe('8 weeks');
    expect(weeksLabel(7)).toBe('1 week');
  });

  it('adds the days left over, so 90 isn’t mental arithmetic', () => {
    expect(weeksLabel(29)).toBe('4 weeks and 1 day');
    expect(weeksLabel(90)).toBe('12 weeks and 6 days');
    expect(weeksLabel(365)).toBe('52 weeks and 1 day');
  });

  it('says only days under a week', () => {
    expect(weeksLabel(3)).toBe('3 days');
  });
});

describe('lengthError (mirrors the length_days check)', () => {
  it('accepts any whole number of days from 28 to 365', () => {
    expect(lengthError(28)).toBeNull();
    expect(lengthError(45)).toBeNull();
    expect(lengthError(365)).toBeNull();
  });

  it('asks for a number when the box is empty or not a whole number', () => {
    expect(lengthError(null)).toBe('Enter a number of days, like 28.');
  });

  it('refuses fewer than 28 days and more than 365', () => {
    expect(lengthError(27)).toBe('A challenge is at least 28 completed days.');
    expect(lengthError(366)).toBe('A challenge can be up to 365 completed days.');
  });
});

describe('parseStakeDollars', () => {
  it.each([
    ['25', 25],
    [' 35 ', 35],
    ['$40', 40],
    ['100', 100],
  ])('reads %p as $%i', (text, dollars) => {
    expect(parseStakeDollars(text)).toBe(dollars);
  });

  it.each(['', 'abc', '10.50', '-5', '1e2'])('rejects %p (stakes are whole dollars)', (text) => {
    expect(parseStakeDollars(text)).toBeNull();
  });
});

describe('stakeError (mirrors the database exactly)', () => {
  const returning = { isFirst: false, outstandingCents: 0 };

  it('accepts $10 and up on a later challenge, with no per-challenge maximum', () => {
    expect(stakeError(10, returning)).toBeNull();
    expect(stakeError(150, returning)).toBeNull();
    expect(stakeError(300, returning)).toBeNull();
  });

  it('asks for a whole-dollar amount when the box is empty or not a number', () => {
    expect(stakeError(null, returning)).toBe('Enter a stake in whole dollars, like 25.');
  });

  it('refuses less than $10 (the insert trigger)', () => {
    expect(stakeError(9, returning)).toBe('The smallest stake is $10.');
    expect(stakeError(0, returning)).toBe('The smallest stake is $10.');
  });

  it('caps a first challenge at $25 (the insert trigger)', () => {
    expect(stakeError(25, { isFirst: true, outstandingCents: 0 })).toBeNull();
    expect(stakeError(26, { isFirst: true, outstandingCents: 0 })).toBe('Your first challenge can have a stake of up to $25.');
  });

  it('caps unfinished stakes at $300 in total, saying how much is left (the insert trigger)', () => {
    expect(stakeError(100, { isFirst: false, outstandingCents: 20000 })).toBeNull();
    expect(stakeError(75, { isFirst: false, outstandingCents: 22500 })).toBeNull();
    expect(stakeError(76, { isFirst: false, outstandingCents: 22500 })).toBe(
      'You have $225 staked on challenges that haven’t ended, and the total can be up to $300. You can stake up to $75 now.',
    );
  });

  it('says to finish one first when there isn’t $10 of room left under the $300, with the real amount', () => {
    expect(stakeError(10, { isFirst: false, outstandingCents: 30000 })).toBe(
      'You have $300 staked on challenges that haven’t ended, and the total can be up to $300. Finish one before starting another.',
    );
    expect(stakeError(10, { isFirst: false, outstandingCents: 29500 })).toBe(
      'You have $295 staked on challenges that haven’t ended, and the total can be up to $300. Finish one before starting another.',
    );
  });

  it('checks in the same order as the database: the minimum, then first challenge, then the total', () => {
    expect(stakeError(5, { isFirst: true, outstandingCents: 30000 })).toBe('The smallest stake is $10.');
    expect(stakeError(30, { isFirst: true, outstandingCents: 30000 })).toBe('Your first challenge can have a stake of up to $25.');
  });

  it('uses the limits from SPEC.md (owner, 2026-09-25: $10 minimum, no per-challenge maximum)', () => {
    expect(STAKE_LIMITS).toEqual({ minDollars: 10, firstChallengeMaxDollars: 25, outstandingMaxDollars: 300 });
  });
});


describe('stakeContext', () => {
  it('is a first challenge when the user has none, whatever their outcomes', () => {
    expect(stakeContext([])).toEqual({ isFirst: true, outstandingCents: 0 });
    expect(stakeContext([{ stake_cents: 2500, outcome: 'not_finished' }]).isFirst).toBe(false);
  });

  it('adds up only the stakes of challenges that haven’t ended', () => {
    const challenges = [
      { stake_cents: 2500, outcome: 'finished' },
      { stake_cents: 10000, outcome: null },
      { stake_cents: 5000, outcome: null },
    ];
    expect(stakeContext(challenges)).toEqual({ isFirst: false, outstandingCents: 15000 });
  });
});

describe('startDate (mirrors the insert trigger: the day after creation, in the challenge time zone)', () => {
  it('is tomorrow in the given time zone', () => {
    // 20:00 UTC on Sept 25 is 13:00 on Sept 25 in Los Angeles.
    expect(startDate('America/Los_Angeles', new Date('2026-09-25T20:00:00Z'))).toBe('2026-09-26');
    // ...but already 05:00 on Sept 26 in Tokyo.
    expect(startDate('Asia/Tokyo', new Date('2026-09-25T20:00:00Z'))).toBe('2026-09-27');
  });

  it('rolls over months and years', () => {
    expect(startDate('America/New_York', new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01');
  });

  it('is the next calendar day across a daylight-saving change', () => {
    // 23:30 PDT on Oct 31, 2026, the night before clocks fall back.
    expect(startDate('America/Los_Angeles', new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-01');
    expect(startDate('America/Los_Angeles', new Date('2026-11-01T18:00:00Z'))).toBe('2026-11-02');
  });
});

describe('challengeErrorMessage', () => {
  it('explains each limit the database enforces', () => {
    expect(challengeErrorMessage({ code: '23514', message: 'first_challenge_stake_limit' })).toBe(
      'Your first challenge can have a stake of up to $25.',
    );
    expect(challengeErrorMessage({ code: '23514', message: 'outstanding_stake_limit' })).toBe(
      'Stakes on your challenges that haven’t ended can be up to $300 in total.',
    );
    expect(challengeErrorMessage({ code: '23514', message: 'stake_minimum' })).toBe('The smallest stake is $10.');
    expect(
      challengeErrorMessage({ code: '23514', message: 'new row violates check constraint "challenges_stake_cents_check"' }),
    ).toBe('Stakes are whole dollars.');
  });

  it('explains a habit that already has a running challenge', () => {
    expect(challengeErrorMessage({ code: '23514', message: 'duplicate_challenge' })).toBe(
      'You already have a challenge for this habit running. Finish it before starting another.',
    );
  });

  it('explains a promise signed without a name on file (0082)', () => {
    expect(challengeErrorMessage({ code: '23514', message: 'name_required' })).toBe(
      'Add your first and last name in Personal info, then sign.',
    );
  });

  it('explains a failed connection', () => {
    expect(challengeErrorMessage({ message: 'Network request failed' })).toBe(
      'Couldn’t reach Kept. Check your connection and try again.',
    );
  });

  it('falls back to a plain sentence for anything else', () => {
    expect(challengeErrorMessage({ code: '42501', message: 'permission denied' })).toBe(
      'Kept couldn’t start this challenge. Please try again.',
    );
  });
});

describe('contractText (the review screen’s promise, in the challenger’s own words)', () => {
  const base = {
    fullName: 'Kenneth Kang',
    habitName: 'Read',
    startsOn: 'Saturday, September 26',
    lengthDays: 28,
    stakeDollars: 35,
    paymentName: 'Card',
    charityName: 'Feeding America',
    isPublic: false,
  };

  it('says who, what, from when and for how long, in one sentence', () => {
    expect(contractText(base)[0]).toBe(
      'I, Kenneth Kang, commit to “Read” every day, starting tomorrow, Saturday, September 26, until I’ve completed 28 days.',
    );
  });

  it('names the language and level for Learn a language', () => {
    expect(contractText({ ...base, habitName: 'Learn a language', language: 'Japanese', level: 'Beginner' })[0]).toBe(
      'I, Kenneth Kang, commit to “Learn a language” (Japanese, beginner) every day, starting tomorrow, Saturday, September 26, until I’ve completed 28 days.',
    );
  });

  it('explains the shields, the stake both ways, who can back it, and the example fee', () => {
    expect(contractText(base).slice(1)).toEqual([
      'Each missed day breaks one of my 2 shields and adds a day to the end. A miss with no shield left ends the challenge.',
      'I’m staking $35 by card. If I finish, my $35 comes back to me. If I don’t, it goes to Feeding America.',
      'Only my friends can back this challenge. Friends who back it check my days, along with Kept’s AI.',
      'On top of my $35 stake, Kept’s service fee is $2.55, so I’d pay $37.55 in all. The fee is non-refundable once I sign.',
    ]);
  });

  it('says what backers see and can’t do when the challenge is public (SPEC-pledges.md decisions 6–8)', () => {
    expect(contractText({ ...base, isPublic: true })[3]).toBe(
      'Backers who aren’t my friends can find this challenge under Discover and back it. They see only its progress (the habit, the day, my shields and the charity), never my username or photo. Only friends who back me check my days, along with Kept’s AI.',
    );
  });

  it('says only friends check the days, and what a day none approves costs, after Don’t allow (T54)', () => {
    expect(contractText({ ...base, aiChecks: false })[3]).toBe(
      'Only my friends can back this challenge. Friends who back it check my days, and a day none of them approves by midnight counts as missed.',
    );
  });

  it('names Solana as the way to pay when chosen', () => {
    expect(contractText({ ...base, paymentName: 'Solana (USDC)' })[2]).toContain('I’m staking $35 by Solana (USDC).');
  });
});

describe('shieldsLabel (what VoiceOver reads, not just icons)', () => {
  it.each([
    [2, '2 of 2 shields left'],
    [1, '1 of 2 shields left'],
    [0, 'No shields left'],
  ])('%i shields reads "%s"', (left, label) => {
    expect(shieldsLabel(left)).toBe(label);
  });

  it('counts bought shields in the total', () => {
    expect(shieldsLabel(1, 3)).toBe('1 of 3 shields left');
  });
});

describe('summarizeChallenge', () => {
  // Noon on Oct 1, 2026 in Los Angeles.
  const now = new Date('2026-10-01T19:00:00Z');
  const row: ChallengeRow = {
    id: 'c1',
    habit_id: 'read',
    language: null,
    level: null,
    length_days: 28,
    stake_cents: 3500,
    start_date: '2026-09-27',
    time_zone: 'America/Los_Angeles',
    day_offset: 0,
    outcome: null,
    ended_on_day: null,
    payment_method: 'card',
    is_public: false,
    habits: { name: 'Read' },
    charities: { name: 'Feeding America' },
    check_ins: [
      { day: 1, status: 'approved' },
      { day: 2, status: 'approved' },
      // day 3 missed
      { day: 4, status: 'approved' },
    ],
  };

  it('waits for a Solana stake the wallet hasn’t paid yet (T169)', () => {
    expect(summarizeChallenge(row, now).awaitingPayment).toBe(false);
    const awaiting = summarizeChallenge({ ...row, payment_method: 'solana_usdc', pay_token: 'USDT', payment_status: 'awaiting' }, now);
    expect(awaiting).toMatchObject({ awaitingPayment: true, paidUpFront: false, paymentName: 'Solana (USDT)' });
    expect(summarizeChallenge({ ...row, payment_method: 'solana_usdc', pay_token: 'USDT', payment_status: 'paid' }, now)).toMatchObject({
      awaitingPayment: false,
      paidUpFront: true,
    });
  });

  it('works out today, progress and shields from the rules', () => {
    expect(summarizeChallenge(row, now)).toMatchObject({
      id: 'c1',
      title: 'Read',
      charityName: 'Feeding America',
      stakeDollars: 35,
      paymentName: 'Card',
      today: 5,
      daysCompleted: 3,
      daysRequired: 29,
      shieldsLeft: 1,
      missedDays: [{ day: 3, boughtCents: null }],
      state: 'active',
      checkedInToday: false,
    });
  });

  it('knows when today is already checked in', () => {
    const done = { ...row, check_ins: [...row.check_ins, { day: 5, status: 'approved' as const }] };
    expect(summarizeChallenge(done, now)).toMatchObject({ checkedInToday: true, daysCompleted: 4, todayText: 'Approved' });
  });

  it('gives today’s check-in status in words, or null before checking in (T25)', () => {
    const waiting = { ...row, check_ins: [...row.check_ins, { day: 5, status: 'pending' as const }] };
    expect(summarizeChallenge(waiting, now).todayText).toBe('Waiting for a friend');
    expect(summarizeChallenge(row, now).todayText).toBeNull();
  });

  it('words the redo after a friend’s flag by the habit', () => {
    const flagged = { ...row, check_ins: [{ day: 5, status: 'flagged' as const }] };
    expect(summarizeChallenge(flagged, now).todayText).toBe('A friend asked for a new photo');
    expect(summarizeChallenge({ ...flagged, habit_id: 'meditate' }, now).todayText).toBe('A friend asked for a new screenshot');
    expect(summarizeChallenge({ ...flagged, habit_id: 'language' }, now).todayText).toBe('A friend asked you to check in again');
  });

  it('is upcoming before Day 1', () => {
    expect(summarizeChallenge({ ...row, start_date: '2026-10-02', check_ins: [] }, now)).toMatchObject({
      state: 'upcoming',
      today: 0,
      startDate: '2026-10-02',
    });
  });

  it('lists each checked-in day in order, with its status in words, crediting Kept’s AI (T27, T29)', () => {
    const byAI = { day: 5, status: 'rejected' as const, reviewed_at: null, ai_checked_at: '2026-10-01T06:00:00+00:00' };
    expect(summarizeChallenge({ ...row, check_ins: [byAI, ...row.check_ins] }, now).days).toEqual([
      { day: 1, status: 'approved', text: 'Approved' },
      { day: 2, status: 'approved', text: 'Approved' },
      { day: 4, status: 'approved', text: 'Approved' },
      { day: 5, status: 'rejected', text: 'Not approved' },
    ]);
  });

  it('moves with the demo clock', () => {
    expect(summarizeChallenge({ ...row, day_offset: 2 }, now).today).toBe(7);
  });

  it('uses a recorded outcome as final', () => {
    expect(summarizeChallenge({ ...row, outcome: 'not_finished', ended_on_day: 5 }, now).state).toBe('not_finished');
  });

  it('shows an ending the rules see before the app has recorded it', () => {
    const threeMisses = { ...row, check_ins: [] };
    expect(summarizeChallenge(threeMisses, now)).toMatchObject({ state: 'not_finished', endedOnDay: 3 });
  });

  it('names the language and level for Learn a language', () => {
    const language = { ...row, habit_id: 'language', language: 'japanese', level: 'beginner', habits: { name: 'Learn a language' } };
    expect(summarizeChallenge(language, now).title).toBe('Learn a language: Japanese, beginner');
  });
});

describe('stampDays (the challenge’s stamp card: every day so far and to come)', () => {
  const now = new Date('2026-10-01T19:00:00Z'); // Day 5 of the row below.
  const row: ChallengeRow = {
    id: 'c1', habit_id: 'read', language: null, level: null, length_days: 28, stake_cents: 3500,
    start_date: '2026-09-27', time_zone: 'America/Los_Angeles', day_offset: 0, outcome: null, ended_on_day: null,
    payment_method: 'card', is_public: false, habits: { name: 'Read' }, charities: { name: 'Feeding America' },
    check_ins: [
      { day: 1, status: 'approved' },
      { day: 2, status: 'excused' },
      // day 3: no check-in
      { day: 4, status: 'pending' },
    ],
  };

  it('stamps kept days, marks misses, leaves days under review open, and outlines today', () => {
    const days = stampDays(summarizeChallenge(row, now));
    expect(days.slice(0, 6).map((d) => d.kind)).toEqual(['kept', 'kept', 'missed', 'open', 'today', 'ahead']);
    expect(days[2].text).toBe('No check-in');
    expect(days[4].text).toBe('Not checked in yet');
  });

  it('runs to the days required, including the one a miss added', () => {
    expect(stampDays(summarizeChallenge(row, now))).toHaveLength(29);
  });

  it('marks a day to redo (a friend or the AI asked for a new one) apart from one under review', () => {
    const redo = { ...row, check_ins: [...row.check_ins, { day: 5, status: 'flagged' as const }] };
    expect(stampDays(summarizeChallenge(redo, now))[4].kind).toBe('redo');
  });

  it('counts a rejected day as missed, and stops where an ended challenge ended', () => {
    const ended = { ...row, outcome: 'not_finished' as const, ended_on_day: 4, check_ins: [{ day: 4, status: 'rejected' as const }] };
    const days = stampDays(summarizeChallenge(ended, now));
    expect(days.map((d) => d.kind)).toEqual(['missed', 'missed', 'missed', 'missed']);
  });
});

describe('duplicateChallengeError (one running challenge per habit; per language for Learn a language)', () => {
  const running = [
    { habit_id: 'read', language: null },
    { habit_id: 'language', language: 'korean' },
  ];

  it('refuses a habit that already has a running challenge', () => {
    expect(duplicateChallengeError('read', null, 'Read', running)).toBe(
      'You already have a “Read” challenge running. Finish it before starting another.',
    );
  });

  it('refuses a language that already has a running challenge, whatever the level', () => {
    expect(duplicateChallengeError('language', 'korean', 'Learn a language', running)).toBe(
      'You already have a Korean challenge running. Finish it before starting another.',
    );
  });

  it('allows a different habit, or a different language', () => {
    expect(duplicateChallengeError('cook', null, 'Cook at home', running)).toBeNull();
    expect(duplicateChallengeError('language', 'japanese', 'Learn a language', running)).toBeNull();
  });

  it('waits for a language before judging Learn a language', () => {
    expect(duplicateChallengeError('language', null, 'Learn a language', running)).toBeNull();
  });
});

describe('checkInErrorMessage', () => {
  it('explains a second check-in on the same day (the unique constraint)', () => {
    expect(checkInErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "check_ins_challenge_id_day_key"' })).toBe(
      'You’ve already checked in today.',
    );
  });

  it('explains a check-in for another day or on an ended challenge (the insert trigger)', () => {
    expect(checkInErrorMessage({ code: '23514', message: 'check_in_not_today' })).toBe(
      'You can only check in for today, on a challenge that’s still running.',
    );
  });

  it('explains a failed connection, and falls back to a plain sentence', () => {
    expect(checkInErrorMessage({ message: 'Network request failed' })).toBe(
      'Couldn’t reach Kept. Check your connection and try again.',
    );
    expect(checkInErrorMessage({ code: '42501', message: 'permission denied' })).toBe(
      'Kept couldn’t check you in. Please try again.',
    );
  });
});

describe('amountAt (T98)', () => {
  it('counts a settlement amount up from $0.00, never past it', () => {
    expect(amountAt('$35.00', 0)).toBe('$0.00');
    expect(amountAt('$35.00', 0.5)).toBe('$17.50');
    expect(amountAt('$35.00', 1)).toBe('$35.00');
    expect(amountAt('$35.00', 1.1)).toBe('$35.00');
    expect(amountAt('$0.29', 1)).toBe('$0.29');
  });

  it('keeps whole dollars whole', () => {
    expect(amountAt('$85', 0.5)).toBe('$42');
  });

  it('leaves anything that isn’t an amount as it is', () => {
    expect(amountAt('12', 0.5)).toBe('12');
  });
});

describe('demo clock (T19)', () => {
  it('is on only when EXPO_PUBLIC_DEMO_CLOCK is exactly "true"', () => {
    expect(demoClockEnabled('true', true)).toBe(true);
    for (const value of [undefined, '', 'false', '1', 'TRUE']) expect(demoClockEnabled(value, true)).toBe(false);
  });

  it('is off in a release build with "true" (T97), the flag the production beta carries', () => {
    expect(demoClockEnabled('true', false)).toBe(false);
  });

  it('is on in any build with "always": the judges’ TestFlight build on the test project (T225)', () => {
    expect(demoClockEnabled('always', false)).toBe(true);
    expect(demoClockEnabled('always', true)).toBe(true);
    expect(demoClockEnabled('ALWAYS', false)).toBe(false);
  });

  // A challenge created the day before: Day 1 is Oct 1, and it's noon on Sept 30 in Los Angeles.
  const now = new Date('2026-09-30T19:00:00Z');
  const fresh: ChallengeRow = {
    id: 'c2',
    habit_id: 'cook',
    language: null,
    level: null,
    length_days: 28,
    stake_cents: 2000,
    start_date: '2026-10-01',
    time_zone: 'America/Los_Angeles',
    day_offset: 0,
    outcome: null,
    ended_on_day: null,
    payment_method: 'card',
    is_public: false,
    habits: { name: 'Cook at home' },
    charities: { name: 'ASPCA' },
    check_ins: [],
  };

  it('starts the challenge with one "Next day", and exposes the offset to move it again', () => {
    expect(summarizeChallenge({ ...fresh, day_offset: 1 }, now)).toMatchObject({ state: 'active', today: 1 });
  });

  it('breaks a shield and adds a day for a day passed without a check-in', () => {
    expect(summarizeChallenge({ ...fresh, day_offset: 2 }, now)).toMatchObject({ today: 2, shieldsLeft: 1, daysRequired: 29 });
  });

  it('keeps every shield when each passed day was checked in', () => {
    const checked = { ...fresh, day_offset: 3, check_ins: [{ day: 1, status: 'approved' as const }, { day: 2, status: 'approved' as const }] };
    expect(summarizeChallenge(checked, now)).toMatchObject({ today: 3, daysCompleted: 2, shieldsLeft: 2 });
  });

  it('keeps running with no shields left after two missed days (owner, 2026-10-01)', () => {
    expect(summarizeChallenge({ ...fresh, day_offset: 3 }, now)).toMatchObject({ state: 'active', shieldsLeft: 0, shieldsTotal: 2 });
  });

  it('ends the challenge as not finished on the third missed day', () => {
    expect(summarizeChallenge({ ...fresh, day_offset: 4 }, now)).toMatchObject({ state: 'not_finished', endedOnDay: 3, shieldsLeft: 0 });
  });
});

describe('revival shields on a summary (owner, 2026-10-01)', () => {
  const now = new Date('2026-09-26T19:00:00Z');
  // Created Sep 25 in Los Angeles: Day 1 is Sep 26. day_offset moves it on, as "Next day" does.
  const ended: ChallengeRow = {
    id: 'c2', habit_id: 'walk-run', language: null, level: null, length_days: 28, stake_cents: 3500,
    start_date: '2026-09-26', time_zone: 'America/Los_Angeles', day_offset: 3, outcome: 'not_finished', ended_on_day: 3,
    payment_method: 'card', is_public: false, habits: { name: 'Walk or run' }, charities: { name: 'ASPCA' }, check_ins: [],
  };

  it('offers the next shield the day after the ending miss: $7 on $35, half and half', () => {
    expect(summarizeChallenge(ended, now).revival).toEqual({ priceCents: 700, charityCents: 350, keptCents: 350 });
  });

  it('offers nothing a day later, after a quit, or after 3 bought', () => {
    expect(summarizeChallenge({ ...ended, day_offset: 4 }, now).revival).toBeNull();
    expect(summarizeChallenge({ ...ended, day_offset: 2, ended_on_day: 2 }, now).revival).toBeNull();
    const three = [1, 2, 3].map((d) => ({ day: d, price_cents: 700 }));
    expect(summarizeChallenge({ ...ended, shield_purchases: three }, now).revival).toBeNull();
  });

  it('lists each missed day and marks the one a shield was bought for', () => {
    const revived = { ...ended, outcome: null, ended_on_day: null, shield_purchases: [{ day: 3, price_cents: 700 }] };
    const c = summarizeChallenge(revived, now);
    expect(c).toMatchObject({ state: 'active', shieldsTotal: 3, shieldsLeft: 0, boughtShields: 1 });
    expect(c.missedDays).toEqual([{ day: 1, boughtCents: null }, { day: 2, boughtCents: null }, { day: 3, boughtCents: 700 }]);
    expect(c.missedDays.map(missedDayText)).toEqual(['Day 1: missed, a shield broke', 'Day 2: missed, a shield broke', 'Day 3: missed, shield bought ($7)']);
  });

  it('says a finish with bought shields in words friends and backers see', () => {
    expect(finishedText(0)).toBe('Finished');
    expect(finishedText(1)).toBe('Finished, with 1 bought shield');
    expect(finishedText(2)).toBe('Finished, with 2 bought shields');
  });

  it('turns a refused purchase into a plain sentence', () => {
    expect(shieldErrorMessage({ code: 'P0001', message: 'shield_not_available' })).toBe('A shield can be bought only on the day after the miss that ended the challenge.');
    expect(shieldErrorMessage({})).toBe('Couldn’t reach Kept. Check your connection and try again.');
  });
});

describe('meStats (Me’s completion numbers; the money given comes from the donations table since T208)', () => {
  const base = { id: 'x', habitId: 'read', title: 'Read', charityName: 'ASPCA', paymentName: 'Card', isPublic: false, lengthDays: 28, startDate: '2026-09-27', timeZone: 'UTC',
    today: 1, days: [], daysCompleted: 0, daysRequired: 28, shieldsLeft: 2, shieldsTotal: 2, missedDays: [], boughtShields: 0, revival: null, underReview: false, endedOnDay: null, quit: false, checkedInToday: false, todayText: null };
  const summary = (state: ChallengeSummary['state'], stakeDollars: number): ChallengeSummary => ({ ...base, state, stakeDollars });

  it('counts finished challenges and the completion rate', () => {
    const summaries = [summary('finished', 25), summary('not_finished', 40), summary('finished', 30), summary('active', 100)];
    expect(meStats(summaries)).toEqual({ finished: 2, ended: 3, percent: 67 });
  });

  it('is all zeros with no ended challenges', () => {
    expect(meStats([summary('upcoming', 25)])).toEqual({ finished: 0, ended: 0, percent: 0 });
  });

  it('leaves a cancelled challenge out of the completion rate (T52)', () => {
    expect(meStats([summary('finished', 25), summary('cancelled', 40)])).toEqual({ finished: 1, ended: 1, percent: 100 });
  });
});

describe('cancelOrQuit (T52)', () => {
  const at = (state: ChallengeSummary['state'], today: number): ChallengeSummary => ({
    id: 'x', habitId: 'read', title: 'Read', charityName: 'ASPCA', paymentName: 'Card', isPublic: false, lengthDays: 28, startDate: '2026-09-27', timeZone: 'UTC',
    days: [], daysCompleted: 0, daysRequired: 28, shieldsLeft: 2, shieldsTotal: 2, missedDays: [], boughtShields: 0, revival: null, underReview: false, endedOnDay: null, quit: false, checkedInToday: false, todayText: null,
    state, today, stakeDollars: 25,
  });

  it('offers Cancel until the end of Day 1, then Quit, and nothing once it has ended', () => {
    expect(cancelOrQuit(at('upcoming', 0))).toBe('cancel');
    expect(cancelOrQuit(at('active', 1))).toBe('cancel');
    expect(cancelOrQuit(at('active', 2))).toBe('quit');
    expect(cancelOrQuit(at('finished', 28))).toBeNull();
    expect(cancelOrQuit(at('cancelled', 1))).toBeNull();
  });

  it('a cancelled challenge’s results: stake and pledges back, the fee kept', () => {
    const pledged = [{ kind: 'supporter' as const, username: 'sam.lee', avatar_path: null, backer: null, amount_cents: 2500, donate_if_not_finished: true, to_charity_on_finish: true }];
    expect(settlementLines({ ...at('cancelled', 1), charityName: 'ASPCA' }, { pledges: pledged })).toEqual([
      { label: 'Back to your card', value: '$25.00' },
      { label: 'sam.lee’s pledge, back to them', value: '$25.00' },
      { label: 'Total to ASPCA', value: '$0.00' },
      { label: 'Service fee (example, not charged; non-refundable)', value: '$2.25' },
    ]);
  });
});

describe('outcomeUpdate (T20: the ending is recorded once, when the app first sees it)', () => {
  // Noon on Oct 1, 2026 in Los Angeles: day 5 of a challenge that started Sep 27.
  const now = new Date('2026-10-01T19:00:00Z');
  const row: ChallengeRow = {
    id: 'c1', habit_id: 'read', language: null, level: null, length_days: 28, stake_cents: 3500,
    start_date: '2026-09-27', time_zone: 'America/Los_Angeles', day_offset: 0, outcome: null, ended_on_day: null,
    payment_method: 'card', is_public: false, habits: { name: 'Read' }, charities: { name: 'Feeding America' },
    check_ins: [{ day: 1, status: 'approved' }],
  };

  it('records the third miss as not finished, on the day it happened', () => {
    // Days 2, 3 and 4 missed.
    expect(outcomeUpdate(row, now)).toEqual({ outcome: 'not_finished' });
  });

  it('waits to record a finish while its last day is still being checked (security review: the server refuses it until then)', () => {
    const lastPending = { ...row, day_offset: 30, check_ins: Array.from({ length: 28 }, (_, i) => ({ day: i + 1, status: (i === 27 ? 'pending' : 'approved') as 'pending' | 'approved' })) };
    expect(outcomeUpdate(lastPending, now)).toBeNull();
  });

  it('records finishing on the day the completed days reach the length', () => {
    const allDone = { ...row, day_offset: 30, check_ins: Array.from({ length: 28 }, (_, i) => ({ day: i + 1, status: 'approved' as const })) };
    expect(outcomeUpdate(allDone, now)).toEqual({ outcome: 'finished' });
  });

  it('records nothing while the challenge is running', () => {
    const running = { ...row, check_ins: [1, 2, 3, 4].map((day) => ({ day, status: 'approved' as const })) };
    expect(outcomeUpdate(running, now)).toBeNull();
  });

  it('records nothing once an outcome is recorded, since it is final', () => {
    expect(outcomeUpdate({ ...row, outcome: 'not_finished', ended_on_day: 4 }, now)).toBeNull();
  });
});

describe('feeLines and raiseText with Kept credits (T164)', () => {
  it('takes credits off the fee, never more than the fee', () => {
    expect(feeLines('Pledge', 2500, 135)).toEqual([
      { label: 'Pledge', value: '$25.00' },
      { label: 'Kept’s service fee', value: '$2.25' },
      { label: 'Paid with Kept credits', value: '−$1.35' },
      { label: 'Total', value: '$25.90' },
    ]);
    expect(feeLines('Stake', 1000, 500).at(-1)).toEqual({ label: 'Total', value: '$10.00' });
  });

  it('takes credits off a raise’s extra fee', () => {
    expect(raiseText(1000, 2500, 500)).toBe('You’ve paid $11.80. Raising to $25 adds $15.00: $15.00 more pledged and $0.45 more fee, $0.45 of the fee paid with Kept credits.');
  });

  it('lets Kept balance pay first, with no fee on its part (T189)', () => {
    expect(feeLines('Stake', 3500, 0, 5000)).toEqual([
      { label: 'Stake', value: '$35.00' },
      { label: 'From your Kept balance', value: '−$35.00' },
      { label: 'Kept’s service fee', value: '$0.00' },
      { label: 'Total', value: '$0.00' },
    ]);
    expect(raiseText(1000, 2500, 0, 2000)).toBe('You’ve paid $11.80. Raising to $25 adds $0.00: $15.00 more pledged and $0.00 more fee, $15.00 of the pledge from your Kept balance.');
  });
});

describe('feeLines: what someone pays, listed to the cent (T63)', () => {
  it('lists the pledge, the fee on top and the total', () => {
    expect(feeLines('Pledge', 1000)).toEqual([
      { label: 'Pledge', value: '$10.00' },
      { label: 'Kept’s service fee', value: '$1.80' },
      { label: 'Total', value: '$11.80' },
    ]);
  });

  it('lists a stake the same way', () => {
    expect(feeLines('Stake', 3500).map((l) => l.value)).toEqual(['$35.00', '$2.55', '$37.55']);
  });
});

describe('raiseText (what raising a pledge adds, T63)', () => {
  it('says what the raise adds, with its share of the fee', () => {
    expect(raiseText(1000, 2500)).toBe('You’ve paid $11.80. Raising to $25 adds $15.45: $15.00 more pledged and $0.45 more fee.');
  });
});

describe('donationRoute (how the money reaches the charity, T61)', () => {
  it('names the charity and the hops: held, sent with the giver’s name, a finisher’s reward, the rest returned', () => {
    expect(donationRoute('ASPCA')).toEqual([
      { label: 'While it runs', detail: 'Kept holds the stake and every pledge.' },
      { label: 'When it ends', detail: 'Kept sends each donation to ASPCA through its donation partner, with the giver’s name on it.' },
      { label: 'A finish', detail: 'The stake comes back, and each pledge goes to the challenger as their reward, unless its pledger chose the charity.' },
      { label: 'Everything else', detail: 'Goes back to the card or wallet it came from.' },
    ]);
  });
});

describe('settlementLines (where every pretend dollar goes, on the results screen)', () => {
  const base: ChallengeSummary = { id: 'x', habitId: 'read', title: 'Read', charityName: 'Doctors Without Borders', stakeDollars: 35, paymentName: 'Card', isPublic: false,
    lengthDays: 28, startDate: '2026-09-27', timeZone: 'UTC', today: 29, days: [], daysCompleted: 28, daysRequired: 28, shieldsLeft: 2,
    shieldsTotal: 2, missedDays: [], boughtShields: 0, revival: null, underReview: false, state: 'finished', endedOnDay: 28, quit: false, checkedInToday: true, todayText: 'Approved' };

  it('paid on Solana: the fee was really paid, so no row calls it an example', () => {
    const wallet = { ...base, paymentName: 'Solana (USDT)' };
    expect(settlementLines(wallet).at(-1)).toEqual({ label: 'Service fee (paid, kept either way)', value: '$2.55' });
    expect(settlementLines({ ...wallet, state: 'cancelled' }).at(-1)).toEqual({ label: 'Service fee (paid, kept either way)', value: '$2.55' });
  });

  it('finished by card: the stake goes back to the card, plus the example fee', () => {
    expect(settlementLines(base)).toEqual([
      { label: 'Back to your card', value: '$35.00' },
      { label: 'Service fee (example, not charged)', value: '$2.55' },
    ]);
  });

  it('finished by Solana: the stake goes back to the wallet', () => {
    expect(settlementLines({ ...base, paymentName: 'Solana (USDC)' })[0]).toEqual({ label: 'Back to your wallet', value: '$35.00' });
  });

  it('not finished: the stake goes to the charity, to the cent', () => {
    expect(settlementLines({ ...base, state: 'not_finished', stakeDollars: 17 })).toEqual([
      { label: 'To Doctors Without Borders', value: '$17.00' },
      { label: 'Service fee (example, not charged)', value: '$2.01' },
    ]);
  });

  it('has nothing to show while the challenge is running', () => {
    expect(settlementLines({ ...base, state: 'active' })).toEqual([]);
  });

  // v2's worked example (T32): a $35 stake and two $25 pledges, both ways.
  const pledge = (username: string, donate = false, toCharity = false) => ({
    kind: 'supporter' as const, username, avatar_path: null, backer: null, amount_cents: 2500, donate_if_not_finished: donate, to_charity_on_finish: toCharity,
  });
  const pledges = [pledge('sam.lee'), pledge('kim')];

  it('worked example, finished: $35 back, and both pledges ($50) to the challenger as their reward (decision 143)', () => {
    expect(settlementLines(base, { pledges })).toEqual([
      { label: 'Back to your card', value: '$35.00' },
      { label: 'sam.lee’s pledge, to you, your reward', value: '$25.00' },
      { label: 'kim’s pledge, to you, your reward', value: '$25.00' },
      { label: 'Your reward for finishing', value: '$50.00' },
      { label: 'Total to Doctors Without Borders', value: '$0.00' },
      { label: 'Service fee (example, not charged)', value: '$2.55' },
    ]);
  });

  it('finished: a pledger who chose the charity gives theirs to it, and the rest is the reward', () => {
    expect(settlementLines(base, { pledges: [pledge('sam.lee', false, true), pledge('kim')] })).toEqual([
      { label: 'Back to your card', value: '$35.00' },
      { label: 'sam.lee’s pledge, to Doctors Without Borders', value: '$25.00' },
      { label: 'kim’s pledge, to you, your reward', value: '$25.00' },
      { label: 'Your reward for finishing', value: '$25.00' },
      { label: 'Total to Doctors Without Borders', value: '$25.00' },
      { label: 'Service fee (example, not charged)', value: '$2.55' },
    ]);
  });

  it('worked example, not finished: $35 to the charity, and each supporter’s $25 back', () => {
    expect(settlementLines({ ...base, state: 'not_finished' }, { pledges })).toEqual([
      { label: 'To Doctors Without Borders', value: '$35.00' },
      { label: 'sam.lee’s pledge, back to them', value: '$25.00' },
      { label: 'kim’s pledge, back to them', value: '$25.00' },
      { label: 'Total to Doctors Without Borders', value: '$35.00' },
      { label: 'Service fee (example, not charged)', value: '$2.55' },
    ]);
  });

  it('finished: each backer’s Kept credits show as their own line', () => {
    const backer = { kind: 'backer' as const, username: null, avatar_path: null, backer: 'Backer A', amount_cents: 2500, donate_if_not_finished: false, to_charity_on_finish: false };
    expect(settlementLines(base, { pledges: [pledge('sam.lee'), backer] })).toEqual([
      { label: 'Back to your card', value: '$35.00' },
      { label: 'sam.lee’s pledge, to you, your reward', value: '$25.00' },
      { label: 'Backer A’s pledge, to you, your reward', value: '$25.00' },
      { label: 'Your reward for finishing', value: '$50.00' },
      { label: 'Total to Doctors Without Borders', value: '$0.00' },
      { label: 'Backer A earns Kept credits', value: '$2.25' },
      { label: 'Service fee (example, not charged)', value: '$2.55' },
    ]);
  });

  it('a pledge set to donate either way, a backer by letter, and extra gifts all reach the charity', () => {
    const backer = { kind: 'backer' as const, username: null, avatar_path: null, backer: 'Backer A', amount_cents: 1000, donate_if_not_finished: false, to_charity_on_finish: false };
    expect(settlementLines({ ...base, state: 'not_finished' }, { pledges: [pledge('sam.lee', true), backer], giftsCents: 1500 })).toEqual([
      { label: 'To Doctors Without Borders', value: '$35.00' },
      { label: 'sam.lee’s pledge, to Doctors Without Borders', value: '$25.00' },
      { label: 'Backer A’s pledge, back to them', value: '$10.00' },
      { label: 'Extra gifts, to Doctors Without Borders', value: '$15.00' },
      { label: 'Total to Doctors Without Borders', value: '$75.00' },
      { label: 'Service fee (example, not charged)', value: '$2.55' },
    ]);
  });
});

describe('finishShieldsLine (the shareable finish card)', () => {
  it('celebrates a finish without a single miss', () => {
    expect(finishShieldsLine(2)).toBe('Never missed a day');
  });

  it('otherwise says how many shields were left', () => {
    expect(finishShieldsLine(1)).toBe('1 of 2 shields left');
  });
});

describe('completionRateText (a friend’s profile, SPEC.md’s "3 of 5, 60%")', () => {
  it('shows finished of ended, with the percent', () => {
    expect(completionRateText({ finished: 3, ended: 5, percent: 60 })).toBe('3 of 5, 60%');
  });

  it('says so when nothing has ended yet', () => {
    expect(completionRateText({ finished: 0, ended: 0, percent: 0 })).toBe('None ended yet');
  });
});

describe('summarizeChallenge and the public choice (T44)', () => {
  it('carries is_public through, so the detail screen can show and change it', () => {
    const row: ChallengeRow = {
      id: 'c9', habit_id: 'read', language: null, level: null, length_days: 28, stake_cents: 1000, start_date: '2026-10-01',
      time_zone: 'UTC', day_offset: 0, outcome: null, ended_on_day: null, payment_method: 'card', is_public: true,
      habits: { name: 'Read' }, charities: { name: 'Oceana' }, check_ins: [],
    };
    expect(summarizeChallenge(row, new Date('2026-10-02T12:00:00Z')).isPublic).toBe(true);
    expect(summarizeChallenge({ ...row, is_public: false }, new Date('2026-10-02T12:00:00Z')).isPublic).toBe(false);
  });
});

describe('money (amounts in sentences and totals)', () => {
  it('drops the cents on whole dollars and keeps them otherwise', () => {
    expect(money(3500)).toBe('$35');
    expect(money(250)).toBe('$2.50');
    expect(money(0)).toBe('$0');
  });
});

describe('summarizeChallenge after a quit or a cancel (review, 2026-10-04)', () => {
  // Noon on Oct 1, 2026 in Los Angeles: Day 5 of a challenge that started Sep 27; day_offset 4 makes it Day 9.
  const now = new Date('2026-10-01T19:00:00Z');
  const quit: ChallengeRow = {
    id: 'q1',
    habit_id: 'read',
    language: null,
    level: null,
    length_days: 28,
    stake_cents: 3500,
    start_date: '2026-09-27',
    time_zone: 'America/Los_Angeles',
    day_offset: 4,
    outcome: 'not_finished',
    ended_on_day: 5,
    payment_method: 'card',
    is_public: false,
    habits: { name: 'Read' },
    charities: { name: 'Feeding America' },
    check_ins: [1, 2, 3, 4].map((day) => ({ day, status: 'approved' as const })),
  };

  it('stops counting at the quit: no misses after it, shields kept, and says it was a quit', () => {
    const c = summarizeChallenge(quit, now);
    expect(c).toMatchObject({ state: 'not_finished', quit: true, shieldsLeft: 2, daysRequired: 28, endedOnDay: 5 });
    expect(c.missedDays).toEqual([]);
  });

  it('counts no misses on a cancelled challenge seen days later', () => {
    const c = summarizeChallenge({ ...quit, outcome: 'cancelled', ended_on_day: 1, check_ins: [] }, now);
    expect(c).toMatchObject({ state: 'cancelled', quit: false, shieldsLeft: 2, daysRequired: 28 });
    expect(c.missedDays).toEqual([]);
  });

  it('isn’t a quit when the misses ended it', () => {
    const c = summarizeChallenge({ ...quit, ended_on_day: 3, check_ins: [] }, now);
    expect(c).toMatchObject({ state: 'not_finished', quit: false, shieldsLeft: 0, endedOnDay: 3 });
    expect(c.missedDays.map((d) => d.day)).toEqual([1, 2, 3]);
  });
});

describe('habitGroup (the habit step’s headings, T109; the ranges in migration 0043)', () => {
  it('puts each habit under Mind, Body, Food, Calm or Making by its place in the list', () => {
    expect([1, 6].map(habitGroup)).toEqual(['Mind', 'Mind']);
    expect([7, 11].map(habitGroup)).toEqual(['Body', 'Body']);
    expect([12, 13].map(habitGroup)).toEqual(['Food', 'Food']);
    expect([14, 15].map(habitGroup)).toEqual(['Calm', 'Calm']);
    expect([16, 17, 40].map(habitGroup)).toEqual(['Making', 'Making', 'Making']);
  });
});

describe('pastMoney (Past challenges, T137)', () => {
  const ended = { stakeDollars: 25, charityName: 'Feeding America' };

  it('says the stake came back after a finish or a cancel', () => {
    expect(pastMoney({ ...ended, state: 'finished' })).toEqual({ amount: '$25', line: 'back to you' });
    expect(pastMoney({ ...ended, state: 'cancelled' })).toEqual({ amount: '$25', line: 'back to you' });
  });

  it('says where it went otherwise', () => {
    expect(pastMoney({ ...ended, state: 'not_finished' })).toEqual({ amount: '$25', line: 'to Feeding America' });
  });
});

describe('deletionBlockedMessage (no deleting mid-challenge, decision 103)', () => {
  it('allows deleting once nothing with money on it is still running', () => {
    expect(deletionBlockedMessage(0, [])).toBeNull();
    expect(deletionBlockedMessage(0, ['finished', 'not_finished', 'cancelled'])).toBeNull();
  });

  it('refuses while your own challenge or one you back hasn’t ended', () => {
    expect(deletionBlockedMessage(1, [])).toBe(DELETION_BLOCKED_MESSAGE);
    expect(deletionBlockedMessage(0, ['finished', null])).toBe(DELETION_BLOCKED_MESSAGE);
  });

  it('also waits while Kept balance or money waiting for a choice is left (decision 151)', () => {
    expect(moneyInKeptMessage(1500, 0)).toBe(MONEY_IN_KEPT_MESSAGE);
    expect(moneyInKeptMessage(0, 1)).toBe(MONEY_IN_KEPT_MESSAGE);
    expect(moneyInKeptMessage(0, 0)).toBeNull();
  });
});

describe('stampWindow (at most four weeks of the stamp card show, so a long challenge never scrolls far)', () => {
  it('shows every day of a challenge of four weeks or less', () => {
    expect(stampWindow(28, 10)).toEqual({ from: 1, to: 28, startWeek: 0, hasPrev: false, hasNext: false });
    expect(stampWindow(14, 3)).toEqual({ from: 1, to: 14, startWeek: 0, hasPrev: false, hasNext: false });
  });

  it('starts a long challenge at its first four weeks, with more to come', () => {
    expect(stampWindow(365, 1)).toEqual({ from: 1, to: 28, startWeek: 0, hasPrev: false, hasNext: true });
    expect(stampWindow(365, 0)).toMatchObject({ from: 1, to: 28 });
  });

  it('keeps today in the third row (60–70% down the board): the window moves by whole weeks', () => {
    expect(stampWindow(365, 20)).toMatchObject({ from: 1, to: 28 });
    expect(stampWindow(365, 30)).toEqual({ from: 15, to: 42, startWeek: 2, hasPrev: true, hasNext: true });
    expect(stampWindow(365, 100)).toMatchObject({ from: 85, to: 112 });
  });

  it('ends on the last days, not past them', () => {
    expect(stampWindow(365, 365)).toEqual({ from: 344, to: 365, startWeek: 49, hasPrev: true, hasNext: false });
  });

  it('pages by four weeks when the user moves it, never off either end', () => {
    expect(stampWindow(365, 30, 10)).toMatchObject({ from: 71, to: 98 });
    expect(stampWindow(365, 30, -5)).toMatchObject({ from: 1, to: 28, hasPrev: false });
    expect(stampWindow(365, 30, 999)).toMatchObject({ to: 365, hasNext: false });
  });
});

describe('demoClockCanMove', () => {
  const base = { state: 'active', quit: false, endedOnDay: null, today: 3 } as const;

  it('moves a running challenge', () => {
    expect(demoClockCanMove(base)).toBe(true);
    expect(demoClockCanMove({ ...base, state: 'upcoming', today: 0 })).toBe(true);
  });

  it('moves a challenge that failed today, so the shield offer tomorrow can be reached', () => {
    expect(demoClockCanMove({ ...base, state: 'not_finished', endedOnDay: 3 })).toBe(true);
  });

  it('stops once the shield offer is open: another day would end the offer', () => {
    expect(demoClockCanMove({ ...base, state: 'not_finished', endedOnDay: 3, today: 4 })).toBe(false);
  });

  it('does not move a challenge the user quit or one that is over', () => {
    expect(demoClockCanMove({ ...base, state: 'not_finished', endedOnDay: 3, quit: true })).toBe(false);
    expect(demoClockCanMove({ ...base, state: 'finished' })).toBe(false);
    expect(demoClockCanMove({ ...base, state: 'cancelled' })).toBe(false);
  });
});
