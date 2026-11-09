// Unit tests for ai-limit.ts: the ceiling on a user's AI calls, what a day over it becomes, and the step-in
// time (plan.md decision 180, T240). Run with the app's jest.
import {
  allowanceFor,
  DEFAULT_STEP_IN,
  EARLIEST_STEP_IN,
  isStepIn,
  overLimitUpdate,
  quizOpensAt,
  retakeWindowText,
  stepInFromClock,
  stepInLabel,
  stepInOrDefault,
  stepInPhrase,
} from './ai-limit';

describe('allowanceFor (3 AI calls for each active stake challenge, at least 4)', () => {
  it('is 4 with none or one, then 3 for each', () => {
    expect([0, 1, 2, 3, 5].map(allowanceFor)).toEqual([4, 4, 6, 9, 15]);
  });

  it('never goes below the floor, whatever it is given', () => {
    expect(allowanceFor(-3)).toBe(4);
    expect(allowanceFor(Number.NaN)).toBe(4);
  });
});

describe('overLimitUpdate (the first day over the limit in a challenge is free, later ones are an appealable miss)', () => {
  it('excuses the first, with a reason that says why', () => {
    const update = overLimitUpdate(true);
    expect(update.status).toBe('excused');
    expect(update.ai_reason).toMatch(/limit/i);
  });

  it('rejects the rest and says they can be appealed', () => {
    const update = overLimitUpdate(false);
    expect(update).toMatchObject({ status: 'rejected', ai_verdict: 'not_approved' });
    expect(update.ai_reason).toMatch(/appeal/i);
  });

  it('fits the 500 characters the reason column holds', () => {
    expect(overLimitUpdate(true).ai_reason.length).toBeLessThanOrEqual(500);
    expect(overLimitUpdate(false).ai_reason.length).toBeLessThanOrEqual(500);
  });
});

describe('the step-in time (9 pm to midnight, any minute; minutes after midnight)', () => {
  it('starts at 9:00 pm, and 10 pm stays the default', () => {
    expect(EARLIEST_STEP_IN).toBe(1260);
    expect(DEFAULT_STEP_IN).toBe(1320);
  });

  it('labels a time the way a clock reads', () => {
    expect([1260, 1327, 1380, 1439, 1440].map(stepInLabel)).toEqual(['9:00 pm', '10:07 pm', '11:00 pm', '11:59 pm', 'Midnight']);
  });

  it('says how long a retake has, and that midnight has none', () => {
    expect(retakeWindowText(1260)).toBe('Retakes until midnight: 3 hours');
    expect(retakeWindowText(1320)).toBe('Retakes until midnight: 2 hours');
    expect(retakeWindowText(1395)).toBe('Retakes until midnight: 45 minutes');
    expect(retakeWindowText(1365)).toBe('Retakes until midnight: 1 hour 15 minutes');
    expect(retakeWindowText(1439)).toBe('Retakes until midnight: 1 minute');
    expect(retakeWindowText(1440)).toMatch(/^No retakes/);
  });

  it('opens the quiz at the choice, but never later than 11 pm, since a quiz takes time', () => {
    expect(quizOpensAt(1260)).toBe(1260);
    expect(quizOpensAt(1380)).toBe(1380);
    expect(quizOpensAt(1410)).toBe(1380);
    expect(quizOpensAt(1440)).toBe(1380);
  });

  it('knows a valid choice from anything else, since the database checks the same', () => {
    expect(isStepIn(1260)).toBe(true);
    expect(isStepIn(1327)).toBe(true);
    expect(isStepIn(1440)).toBe(true);
    expect(isStepIn(1259)).toBe(false);
    expect(isStepIn(1441)).toBe(false);
    expect(isStepIn(1327.5)).toBe(false);
    expect(isStepIn('1320')).toBe(false);
    expect(isStepIn(null)).toBe(false);
  });

  it('reads the clock dial: midnight is the end of the day, and nothing falls outside 9 pm to midnight', () => {
    expect(stepInFromClock(0)).toBe(1440);
    expect(stepInFromClock(1300)).toBe(1300);
    expect(stepInFromClock(1439)).toBe(1439);
    expect(stepInFromClock(1000)).toBe(1260);
  });

  it('says a time in a sentence: on the hour without minutes, and midnight in lowercase', () => {
    expect(stepInPhrase(1260)).toBe('9 pm');
    expect(stepInPhrase(1320)).toBe('10 pm');
    expect(stepInPhrase(1327)).toBe('10:07 pm');
    expect(stepInPhrase(1440)).toBe('midnight');
  });

  it('reads a missing or invalid saved choice as 10 pm, so an app ahead of the database still works', () => {
    expect(stepInOrDefault(1395)).toBe(1395);
    expect(stepInOrDefault(1262)).toBe(1262);
    expect(stepInOrDefault(1440)).toBe(1440);
    expect(stepInOrDefault(undefined)).toBe(DEFAULT_STEP_IN);
    expect(stepInOrDefault(null)).toBe(DEFAULT_STEP_IN);
    expect(stepInOrDefault(1200)).toBe(DEFAULT_STEP_IN);
    expect(stepInOrDefault('1380')).toBe(DEFAULT_STEP_IN);
  });
});
