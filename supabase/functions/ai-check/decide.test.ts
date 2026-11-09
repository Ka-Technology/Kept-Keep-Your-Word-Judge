// Unit tests for decide.ts: what one due check-in becomes, with the AI as a last resort behind a per-user
// ceiling (plan.md decision 180, T244). Every dependency is injected, so each path is tried without a network.
import { overLimitUpdate } from '../_shared/ai-limit';
import { decideCheckIn, type Due, type Io } from './decide';
import { noQuizUpdate, PhotoUnreadable, unreadableUpdate } from './rules';

const MODEL = 'test-model';

function due(over: Partial<Due> = {}): Due {
  return {
    id: 'ci1',
    habit_id: 'workout',
    day: 3,
    photo_path: 'u1/ch1/3-1.jpg',
    photo_taken_at: '2026-11-03T20:00:00Z',
    time_zone: 'America/Los_Angeles',
    flag_note: null,
    retake_asked: false,
    day_ended: false,
    book: null,
    quiz: null,
    user_id: 'u1',
    challenge_id: 'ch1',
    ...over,
  };
}

function makeIo(over: Partial<Io> = {}) {
  const io = {
    photoUrl: jest.fn(async () => 'https://signed.example/photo'),
    take: jest.fn(async (): Promise<number | null> => 7),
    release: jest.fn(async () => {}),
    firstOverLimitDay: jest.fn(async () => true),
    ask: jest.fn(async () => ({ verdict: 'approve' as const, reason: 'A person at the gym.' })),
    warn: jest.fn(),
    ...over,
  };
  return io as typeof io & Io;
}

describe('a check-in the AI is asked about', () => {
  it('takes one of the user’s calls, asks, and records the verdict', async () => {
    const io = makeIo();
    const { update, log } = await decideCheckIn(due(), io, MODEL);
    expect(update).toEqual({ status: 'approved', ai_verdict: 'approve', ai_reason: 'A person at the gym.', ai_model: MODEL });
    expect(io.take).toHaveBeenCalledWith('u1');
    expect(io.ask).toHaveBeenCalledWith('https://signed.example/photo', expect.stringContaining('Day 3'));
    expect(io.release).not.toHaveBeenCalled();
    expect(log).toMatchObject({ habit: 'workout', verdict: 'approve', status: 'approved', model: MODEL });
  });

  it('cuts a long reason to the 500 characters the column holds', async () => {
    const io = makeIo({ ask: jest.fn(async () => ({ verdict: 'approve' as const, reason: 'x'.repeat(900) })) });
    expect(((await decideCheckIn(due(), io, MODEL)).update.ai_reason as string).length).toBe(500);
  });

  it('asks a Learn a language day about its quiz, with no photo', async () => {
    const quiz = { attempts: [{ questions: [{ kind: 'vocabulary', prompt: 'Translate: gato' }], answers: ['cat'], grades: ['right' as const], passed: true }] };
    const io = makeIo();
    await decideCheckIn(due({ habit_id: 'language', photo_path: null, quiz }), io, MODEL);
    expect(io.photoUrl).not.toHaveBeenCalled();
    expect(io.take).toHaveBeenCalledTimes(1);
    expect(io.ask).toHaveBeenCalledWith(null, expect.any(String));
  });

  it('turns a retake into approved when one was already asked, since the AI never fails anyone on a guess', async () => {
    const io = makeIo({ ask: jest.fn(async () => ({ verdict: 'retake' as const, reason: 'Too dark.' })) });
    expect((await decideCheckIn(due({ retake_asked: true }), io, MODEL)).update.status).toBe('approved');
    expect((await decideCheckIn(due(), io, MODEL)).update.status).toBe('retake');
  });
});

describe('a user over their limit (the AI is the last resort, so no call is made)', () => {
  it('excuses the first such day in a challenge', async () => {
    const io = makeIo({ take: jest.fn(async () => null), firstOverLimitDay: jest.fn(async () => true) });
    const { update, log } = await decideCheckIn(due(), io, MODEL);
    expect(update).toEqual(overLimitUpdate(true));
    expect(update.status).toBe('excused');
    expect(io.firstOverLimitDay).toHaveBeenCalledWith('ch1', 3);
    expect(io.ask).not.toHaveBeenCalled();
    expect(io.release).not.toHaveBeenCalled();
    expect(log).toBeUndefined();
  });

  it('rejects every later one, with a note that it can be appealed', async () => {
    const io = makeIo({ take: jest.fn(async () => null), firstOverLimitDay: jest.fn(async () => false) });
    const { update } = await decideCheckIn(due(), io, MODEL);
    expect(update).toEqual(overLimitUpdate(false));
    expect(update).toMatchObject({ status: 'rejected', ai_verdict: 'not_approved' });
    expect(io.ask).not.toHaveBeenCalled();
  });
});

describe('when Kept fails, nobody pays for it', () => {
  it('gives the call back and counts the day as done when the AI can’t be reached', async () => {
    const io = makeIo({ ask: jest.fn(async () => { throw new Error('overloaded'); }) });
    const { update } = await decideCheckIn(due(), io, MODEL);
    expect(update).toEqual({ status: 'excused' });
    expect(io.release).toHaveBeenCalledWith(7);
    expect(io.warn).toHaveBeenCalled();
  });

  it('keeps the call counted when the AI answered but its reply was unusable, since that call was paid for', async () => {
    const io = makeIo({ ask: jest.fn(async () => ({ verdict: 'approve' as const, reason: undefined as unknown as string })) });
    const { update } = await decideCheckIn(due(), io, MODEL);
    expect(update).toEqual({ status: 'excused' });
    expect(io.release).not.toHaveBeenCalled();
  });

  it('takes no call for a photo that can’t be read, and asks for a new one', async () => {
    const io = makeIo({ photoUrl: jest.fn(async () => { throw new PhotoUnreadable('not found'); }) });
    const { update } = await decideCheckIn(due(), io, MODEL);
    expect(update).toEqual(unreadableUpdate(true));
    expect(io.take).not.toHaveBeenCalled();
    expect(io.ask).not.toHaveBeenCalled();
  });

  it('gives the call back when Claude says the image is unreadable, and rejects once a retake is no longer possible', async () => {
    const io = makeIo({ ask: jest.fn(async () => { throw Object.assign(new Error('Could not process image'), { status: 400 }); }) });
    expect((await decideCheckIn(due(), io, MODEL)).update).toEqual(unreadableUpdate(true));
    expect(io.release).toHaveBeenCalledWith(7);
    expect((await decideCheckIn(due({ day_ended: true }), io, MODEL)).update).toEqual(unreadableUpdate(false));
  });

  it('counts the day as done, and makes no call, when the ceiling itself can’t be checked', async () => {
    const io = makeIo({ take: jest.fn(async () => { throw new Error('db down'); }) });
    const { update } = await decideCheckIn(due(), io, MODEL);
    expect(update).toEqual({ status: 'excused' });
    expect(io.ask).not.toHaveBeenCalled();
    expect(io.release).not.toHaveBeenCalled();
  });

  it('still returns the day’s update when giving the call back fails', async () => {
    const io = makeIo({ ask: jest.fn(async () => { throw new Error('overloaded'); }), release: jest.fn(async () => { throw new Error('db down'); }) });
    await expect(decideCheckIn(due(), io, MODEL)).resolves.toMatchObject({ update: { status: 'excused' } });
  });
});

describe('a check-in nothing is asked about', () => {
  it('rejects a Learn a language day with no quiz, appealable, with no call', async () => {
    const io = makeIo();
    const { update } = await decideCheckIn(due({ habit_id: 'language', photo_path: null, quiz: null }), io, MODEL);
    expect(update).toEqual(noQuizUpdate(null));
    expect(io.take).not.toHaveBeenCalled();
  });

  it('excuses a Learn a language day whose quiz Kept couldn’t write', async () => {
    const io = makeIo();
    const { update } = await decideCheckIn(due({ habit_id: 'language', photo_path: null, quiz: { attempts: [], skipped: true } }), io, MODEL);
    expect(update).toEqual({ status: 'excused' });
    expect(io.take).not.toHaveBeenCalled();
  });

  it('approves an old check-in from before photos were required as unsure, with no call', async () => {
    const io = makeIo();
    const { update } = await decideCheckIn(due({ photo_path: null }), io, MODEL);
    expect(update).toEqual({ status: 'approved', ai_verdict: 'unsure' });
    expect(io.take).not.toHaveBeenCalled();
  });
});
