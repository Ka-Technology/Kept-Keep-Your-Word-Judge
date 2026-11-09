// Unit tests for quiz.ts: the quiz rules (T42, SPEC-verification.md). Run with the app's jest.
import { quizOpensAt } from './ai-limit';
import { givesAway, localMinutes, nextStep, passes, quizOpen, quizText, withoutRepeats, type Quiz } from './quiz';

describe('quizOpen (friends first: the quiz opens at 10 pm in the challenge’s zone; owner, 2026-09-27)', () => {
  it('opens at 10 pm local, not before', () => {
    // 9:59 pm, 10:00 pm and 11:59 pm on Sep 29 in Los Angeles (UTC-7).
    expect(quizOpen(new Date('2026-09-30T04:59:00Z'), 'America/Los_Angeles')).toBe(false);
    expect(quizOpen(new Date('2026-09-30T05:00:00Z'), 'America/Los_Angeles')).toBe(true);
    expect(quizOpen(new Date('2026-09-30T06:59:00Z'), 'America/Los_Angeles')).toBe(true);
  });

  it('is closed from midnight, and follows the challenge’s zone, not the phone’s', () => {
    expect(quizOpen(new Date('2026-09-30T07:00:00Z'), 'America/Los_Angeles')).toBe(false);
    expect(quizOpen(new Date('2026-09-30T05:00:00Z'), 'Asia/Tokyo')).toBe(false);
  });
});

describe('quizOpen follows the user’s step-in time (plan.md decision 180: 10 pm unless they chose later, never after 11 pm)', () => {
  // Sep 29 in Los Angeles is UTC-7: 10:00 pm there is 05:00Z on Sep 30.
  const LA = 'America/Los_Angeles';
  const at = (hhmmUtc: string) => new Date(`2026-09-30T${hhmmUtc}:00Z`);

  it('reads the zone’s minutes since midnight, and never calls midnight 24:00', () => {
    expect(localMinutes(at('05:30'), LA)).toBe(22 * 60 + 30);
    expect(localMinutes(at('07:05'), LA)).toBe(5);
    expect(localMinutes(at('06:59'), LA)).toBe(23 * 60 + 59);
  });

  it('opens at the chosen time, to the minute', () => {
    expect(quizOpen(at('05:14'), LA, 1335)).toBe(false); // 10:14 pm, chosen 10:15 pm
    expect(quizOpen(at('05:15'), LA, 1335)).toBe(true);
    expect(quizOpen(at('05:44'), LA, 1365)).toBe(false); // 10:44 pm, chosen 10:45 pm
    expect(quizOpen(at('05:45'), LA, 1365)).toBe(true);
  });

  it('opens at 11 pm for a later choice, since a quiz takes time, and still closes at midnight', () => {
    expect(quizOpen(at('05:59'), LA, 1440)).toBe(false); // 10:59 pm, chosen midnight
    expect(quizOpen(at('06:00'), LA, 1440)).toBe(true); // 11:00 pm
    expect(quizOpen(at('06:30'), LA, 1410)).toBe(true);
    expect(quizOpen(at('07:00'), LA, 1440)).toBe(false); // midnight
  });

  it('agrees with ai-limit’s quizOpensAt for every choice', () => {
    // The Los Angeles clock reads `m` minutes after midnight at 07:00Z (that day's midnight) + m minutes.
    const clock = (m: number) => new Date(Date.UTC(2026, 8, 30, 7, 0) - 24 * 60 * 60000 + m * 60000);
    for (const from of [1320, 1335, 1350, 1380, 1395, 1440]) {
      const opens = quizOpensAt(from);
      expect(quizOpen(clock(opens), LA, from)).toBe(true);
      expect(quizOpen(clock(opens - 1), LA, from)).toBe(false);
    }
  });

  it('keeps 10 pm when no setting is given', () => {
    expect(quizOpen(at('04:59'), LA)).toBe(false);
    expect(quizOpen(at('05:00'), LA)).toBe(true);
  });
});

describe('passes (right answers needed, counting only questions the AI was sure of)', () => {
  it('passes Read with 2 of 3, and Learn a language with 3 of 4', () => {
    expect(passes('read', ['right', 'right', 'wrong'])).toBe(true);
    expect(passes('read', ['right', 'wrong', 'wrong'])).toBe(false);
    expect(passes('language', ['right', 'right', 'right', 'wrong'])).toBe(true);
    expect(passes('language', ['right', 'right', 'wrong', 'wrong'])).toBe(false);
  });

  it('never counts a grading the AI wasn’t sure of as wrong', () => {
    expect(passes('read', ['right', 'unsure', 'wrong'])).toBe(true);
  });

  it('lets an unsure grading fill one slot at most, so answers can’t talk a quiz into a pass (review, 2026-10-04)', () => {
    expect(passes('read', ['unsure', 'unsure', 'unsure'])).toBe(false);
    expect(passes('language', ['right', 'unsure', 'unsure', 'wrong'])).toBe(false);
    expect(passes('language', ['right', 'right', 'unsure', 'wrong'])).toBe(true);
  });

  it('needs every answer right when only that many questions were kept', () => {
    expect(passes('read', ['right', 'wrong'])).toBe(false);
    expect(passes('read', ['right', 'right'])).toBe(true);
    expect(passes('language', ['right', 'right'])).toBe(true);
  });
});

describe('withoutRepeats (a retry never repeats a question from the first attempt; owner)', () => {
  it('drops a question asked before, ignoring case, spaces and punctuation', () => {
    const earlier = [{ kind: 'book', prompt: 'Who is Gatsby in love with?' }];
    const retry = [
      { kind: 'book', prompt: 'who is gatsby in love with' },
      { kind: 'page', prompt: 'Where does Nick live?' },
    ];
    expect(withoutRepeats(retry, earlier)).toEqual([{ kind: 'page', prompt: 'Where does Nick live?' }]);
  });
});

describe('nextStep (what the challenger can do with the quiz)', () => {
  const asked = { questions: [{ kind: 'page', prompt: 'Q?' }] };
  const failed = { ...asked, answers: ['a'], grades: ['wrong' as const], passed: false };

  it('starts, then answers the open attempt', () => {
    expect(nextStep(null)).toBe('start');
    expect(nextStep({ attempts: [asked] })).toBe('answer');
  });

  it('allows one retry after a failed quiz, then leaves it to friends', () => {
    expect(nextStep({ attempts: [failed] })).toBe('retry');
    expect(nextStep({ attempts: [failed, failed] })).toBe('done');
  });

  it('is done after a pass, or when there was no quiz (an unknown book)', () => {
    expect(nextStep({ attempts: [{ ...failed, grades: ['right'], passed: true }] })).toBe('done');
    expect(nextStep({ attempts: [], skipped: true })).toBe('done');
  });
});

describe('quizText (the answers, for the AI’s deadline decision)', () => {
  it('lists each question with the answer and its grading', () => {
    const quiz: Quiz = { attempts: [{ questions: [{ kind: 'vocabulary', prompt: '¿Qué es una manzana?' }], answers: ['an apple'], grades: ['right'], passed: false }] };
    expect(quizText(quiz)).toContain('¿Qué es una manzana? → "an apple" (right)');
  });
});

describe('givesAway (a question never shows its own answer; owner, 2026-10-01)', () => {
  it('catches the answer written in the prompt, ignoring case, accents and punctuation', () => {
    expect(givesAway({ kind: 'vocabulary', prompt: 'Translate “the coffee” (el café)' }, 'el cafe')).toBe(true);
    expect(givesAway({ kind: 'book', prompt: 'Who meets Harry at the hut? Answer: Hagrid.' }, 'Hagrid')).toBe(true);
  });

  it('leaves a fair question alone, including a word inside a longer one', () => {
    expect(givesAway({ kind: 'vocabulary', prompt: 'Translate “the cat” into Spanish.' }, 'el gato')).toBe(false);
    expect(givesAway({ kind: 'book', prompt: 'What does Scout call her father?' }, 'Atticus')).toBe(false);
    expect(givesAway({ kind: 'vocabulary', prompt: 'What is a category?' }, 'cat')).toBe(false);
  });

  it('lets a reading passage hold its answer, but never shows a listening phrase', () => {
    expect(givesAway({ kind: 'reading', prompt: 'Ana compra pan. ¿Qué compra Ana?' }, 'pan')).toBe(false);
    expect(givesAway({ kind: 'listening', prompt: 'What does “buenos días” mean?', speak: 'Buenos días' }, 'good morning')).toBe(true);
  });
});
