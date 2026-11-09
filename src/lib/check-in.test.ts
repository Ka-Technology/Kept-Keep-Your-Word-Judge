// Unit tests for check-in.ts: the rules behind a photo check-in (SPEC-verification.md, T25).
import { aiApprovedOnDoubt, canAppeal, checkInPhotoPath, checkInStatusText, decidedByAI, evidenceFor, pagesRead, QUIZ_LIMITED_NOTE, quizProblem, resizeTo, reviewedStatusText, stampText } from './check-in';

describe('canAppeal (mirrors the database: once, on a rejected day, within 7 days; T29)', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const rejected = { status: 'rejected' as const, appealed_at: null, ai_checked_at: '2026-10-02T12:00:00+00:00' };

  it('allows one appeal of a rejected day within 7 days of the rejection', () => {
    expect(canAppeal(rejected, now)).toBe(true);
  });

  it('refuses after 7 days, a second time, and on a day that wasn’t rejected', () => {
    expect(canAppeal({ ...rejected, ai_checked_at: '2026-10-01T11:00:00+00:00' }, now)).toBe(false);
    expect(canAppeal({ ...rejected, appealed_at: '2026-10-03T00:00:00+00:00' }, now)).toBe(false);
    expect(canAppeal({ ...rejected, status: 'approved' }, now)).toBe(false);
  });
});

describe('evidenceFor (SPEC-verification.md’s table: how each habit proves a day)', () => {
  it('takes only a screenshot for Meditate: its proof is the app’s screen on the same phone', () => {
    expect(evidenceFor('meditate')).toBe('screenshot');
  });

  it('takes a photo or a screenshot for Walk or run, Study, LeetCode, Play chess and Ride a bike', () => {
    expect(['walk-run', 'study', 'leetcode', 'chess', 'bike'].map(evidenceFor)).toEqual(Array(5).fill('either'));
    expect(evidenceFor('steps')).toBe('screenshot');
  });

  it('takes nothing for Learn a language until its quiz (T42)', () => {
    expect(evidenceFor('language')).toBe('none');
  });

  it('needs Kept’s camera for everything else', () => {
    expect(['read', 'workout', 'cook', 'journal', 'instrument', 'stretch', 'greens', 'draw'].map(evidenceFor)).toEqual(Array(8).fill('camera'));
  });
});

describe('the redo after a friend’s flag, by habit', () => {
  it('asks for what the habit checks in with', () => {
    expect(reviewedStatusText('flagged', 'sam.lee')).toBe('@sam.lee asked for a new photo');
    expect(reviewedStatusText('flagged', 'sam.lee', false, 'screenshot')).toBe('@sam.lee asked for a new screenshot');
    expect(reviewedStatusText('flagged', 'sam.lee', false, 'either')).toBe('@sam.lee asked for a new photo or screenshot');
    expect(reviewedStatusText('flagged', 'sam.lee', false, 'none')).toBe('@sam.lee asked you to check in again');
    expect(reviewedStatusText('flagged', null, false, 'none')).toBe('A friend asked you to check in again');
  });

  it('words the AI’s retake the same way (T28)', () => {
    expect(reviewedStatusText('retake', null)).toBe('Kept’s AI asked for a new photo');
    expect(reviewedStatusText('retake', null, false, 'screenshot')).toBe('Kept’s AI asked for a new screenshot');
  });
});

describe('checkInPhotoPath (the folder the database requires)', () => {
  it('puts the photo in the user’s folder for that challenge, named by day and time', () => {
    expect(checkInPhotoPath('user-a', 'challenge-1', 5, 1727640000000)).toBe('user-a/challenge-1/5-1727640000000.jpg');
  });
});

describe('stampText (Kept’s time code)', () => {
  // 7:42 pm on Tuesday, September 29, 2026 in Los Angeles.
  const when = new Date('2026-09-30T02:42:00Z');

  it('shows the day, the date and the time in the challenge’s time zone', () => {
    expect(stampText(5, when, 'America/Los_Angeles', true, 'en-US')).toBe('Day 5 · Tue, Sep 29 · 7:42 PM');
  });

  it('leaves out the time before a photo is taken', () => {
    expect(stampText(5, when, 'America/Los_Angeles', false, 'en-US')).toBe('Day 5 · Tue, Sep 29');
  });
});

describe('checkInStatusText (what the challenger sees)', () => {
  it('says what is happening at each step', () => {
    expect(checkInStatusText('pending')).toBe('Waiting for a friend');
    expect(checkInStatusText('flagged')).toBe('A friend asked for a new photo');
    expect(checkInStatusText('ai_checking')).toBe('The AI is checking this');
    expect(checkInStatusText('retake')).toBe('Take a new photo');
    expect(checkInStatusText('appealed')).toBe('Appeal pending');
  });
});

describe('resizeTo (the long side to 1000 px, never larger)', () => {
  it('shrinks a landscape photo by its width', () => {
    expect(resizeTo(4032, 3024)).toEqual({ width: 1000, height: null });
  });

  it('shrinks a portrait photo by its height', () => {
    expect(resizeTo(3024, 4032)).toEqual({ width: null, height: 1000 });
  });

  it('leaves a small photo as it is', () => {
    expect(resizeTo(800, 600)).toBeNull();
  });
});

describe('reviewedStatusText (who reviewed it, for the challenger; T26)', () => {
  it('names the friend who approved it, or who asked for a new photo', () => {
    expect(reviewedStatusText('approved', 'sam.lee')).toBe('Approved by @sam.lee');
    expect(reviewedStatusText('flagged', 'sam.lee')).toBe('@sam.lee asked for a new photo');
  });

  it('falls back to the plain status without a reviewer (the AI, or an unfriended reviewer)', () => {
    expect(reviewedStatusText('approved', null)).toBe('Approved');
    expect(reviewedStatusText('pending', 'sam.lee')).toBe('Waiting for a friend');
  });
});

describe('the AI’s decision (T27)', () => {
  it('says Kept’s AI approved it, even after a friend’s flag', () => {
    expect(reviewedStatusText('approved', null, true)).toBe('Approved by Kept’s AI');
    expect(reviewedStatusText('approved', 'sam.lee', true)).toBe('Approved by Kept’s AI');
  });

  it('credits the AI only when it acted after any friend’s review', () => {
    expect(decidedByAI({ reviewed_at: null, ai_checked_at: null })).toBe(false);
    expect(decidedByAI({ reviewed_at: null, ai_checked_at: '2026-09-29T22:00:00+00:00' })).toBe(true);
    // A friend asked for a new photo, none came, and the AI checked it near the deadline.
    expect(decidedByAI({ reviewed_at: '2026-09-29T20:00:00+00:00', ai_checked_at: '2026-09-29T22:00:00+00:00' })).toBe(true);
    // The AI asked for a new photo (T28), then a friend approved the new one.
    expect(decidedByAI({ reviewed_at: '2026-09-29T21:00:00+00:00', ai_checked_at: '2026-09-29T20:00:00+00:00' })).toBe(false);
  });
});

describe('pagesRead (the book tile on a sent Read check-in, T102)', () => {
  it('counts the pages in a range, however it was typed', () => {
    expect(pagesRead('140 to 160')).toBe(20);
    expect(pagesRead('40–62')).toBe(22);
    expect(pagesRead('pp. 1-30')).toBe(29);
  });

  it('gives nothing it can’t count: one number, a range backwards, or none', () => {
    expect(pagesRead('35')).toBeNull();
    expect(pagesRead('60-40')).toBeNull();
    expect(pagesRead(null)).toBeNull();
  });
});

describe('quizProblem (what the quiz says when it can’t be made or graded; plan.md decision 180)', () => {
  const when = { answering: false, opensAt: '10:30 pm' };

  it('says the limit was reached, and that a friend can still approve the day', () => {
    expect(quizProblem('ai_limit', when)).toMatch(/limit/);
    expect(quizProblem('ai_limit', when)).toMatch(/friend can still approve/);
  });

  it('says when the quiz opens', () => {
    expect(quizProblem('quiz_not_open', when)).toContain('10:30 pm');
  });

  it('asks the user to wait when the quiz is already being made', () => {
    expect(quizProblem('quiz_busy', when)).toMatch(/already making/);
  });

  it('keeps the old words for anything else, by whether answers or questions were being asked for', () => {
    expect(quizProblem(undefined, { ...when, answering: true })).toBe('Your answers couldn’t be checked. Try again.');
    expect(quizProblem('boom', when)).toBe('The quiz couldn’t be made. Try again, or a friend checks this day instead.');
  });

  it('says plainly that the limit is why a day counts without a quiz, not that something broke', () => {
    expect(QUIZ_LIMITED_NOTE).toBe('You’ve reached today’s limit for Kept’s AI, so this quiz can’t be graded. Just this once, this day counts.');
  });
});

describe('an approval the AI wasn’t sure of (no retake left, so it never fails a day on a guess)', () => {
  it('is told apart from a real approval', () => {
    expect(aiApprovedOnDoubt({ status: 'approved', ai_verdict: 'retake' })).toBe(true);
    expect(aiApprovedOnDoubt({ status: 'approved', ai_verdict: 'unsure' })).toBe(true);
    expect(aiApprovedOnDoubt({ status: 'approved', ai_verdict: 'approve' })).toBe(false);
    expect(aiApprovedOnDoubt({ status: 'approved', ai_verdict: null })).toBe(false);
    expect(aiApprovedOnDoubt({ status: 'retake', ai_verdict: 'retake' })).toBe(false);
  });

  it('says so, instead of "Approved by Kept’s AI"', () => {
    expect(reviewedStatusText('approved', null, true, 'camera', true)).toBe('Counted as kept: Kept’s AI couldn’t tell');
    expect(reviewedStatusText('approved', null, true, 'camera', false)).toBe('Approved by Kept’s AI');
  });
});
