// Unit tests for flow.ts: the quiz function's whole flow, with the AI as a last resort behind a per-user ceiling
// and a claim before every AI call (plan.md decision 180, T245). Every dependency is injected.
import type { Grade, Question, Quiz } from '../_shared/quiz';
import { runQuiz, type Io, type Row } from './flow';

// 10:30 pm on Sep 29 in Los Angeles (UTC-7).
const NOW = new Date('2026-09-30T05:30:00Z');
const QS: Question[] = [
  { kind: 'page', prompt: 'Who opens the book?' },
  { kind: 'book', prompt: 'Where is it set?' },
  { kind: 'page', prompt: 'What does she find?' },
];

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'ci1',
    status: 'pending',
    book: 'Pride and Prejudice',
    pages: '1-20',
    photo_path: 'u1/ch1/1-1.jpg',
    quiz: null,
    day: 3,
    challenges: { id: 'ch1', habit_id: 'read', language: null, level: null, time_zone: 'America/Los_Angeles', length_days: 28 },
    ...over,
  };
}

function makeIo(over: Partial<Io> = {}) {
  const io = {
    load: jest.fn(async (): Promise<Row | null> => row()),
    profile: jest.fn(async () => ({ ai_allowed: true as boolean | null, ai_from_minutes: 1320 })),
    imageUrl: jest.fn(async () => 'https://signed.example/page'),
    claimWrite: jest.fn(async () => true),
    saveQuestions: jest.fn(async () => {}),
    releaseWrite: jest.fn(async () => {}),
    claimAnswers: jest.fn(async () => true),
    restoreQuiz: jest.fn(async () => {}),
    saveGraded: jest.fn(async () => {}),
    approve: jest.fn(async () => {}),
    take: jest.fn(async (): Promise<number | null> => 9),
    release: jest.fn(async () => {}),
    firstOverLimitDay: jest.fn(async () => false),
    writeQuestions: jest.fn(async (): Promise<Question[]> => QS),
    grade: jest.fn(async (): Promise<Grade[]> => ['right', 'right', 'wrong']),
    log: jest.fn(),
    ...over,
  };
  return io as typeof io & Io;
}

/** A quiz with one attempt, answered or not. */
const attempt = (extra: Partial<Quiz['attempts'][number]> = {}): Quiz => ({ attempts: [{ questions: QS, ...extra }] });
const start = (io: Io, over: Partial<Parameters<typeof runQuiz>[0]> = {}) => runQuiz({ user: 'u1', checkInId: 'ci1', now: NOW, ...over }, io);

describe('the checks before anything is asked of the AI', () => {
  it('says not found for a check-in that isn’t the user’s', async () => {
    const io = makeIo({ load: jest.fn(async () => null) });
    expect(await start(io)).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(io.take).not.toHaveBeenCalled();
  });

  it('has no quiz for a habit without one, or a check-in that isn’t waiting', async () => {
    expect((await start(makeIo({ load: jest.fn(async () => row({ challenges: { id: 'ch1', habit_id: 'workout', language: null, level: null, time_zone: 'UTC', length_days: 28 } })) }))).status).toBe(409);
    expect(await start(makeIo({ load: jest.fn(async () => row({ status: 'approved' })) }))).toEqual({ status: 409, body: { error: 'no_quiz' } });
  });

  it('sends nothing to the AI unless the user allowed it', async () => {
    const io = makeIo({ profile: jest.fn(async () => ({ ai_allowed: null, ai_from_minutes: 1320 })) });
    expect(await start(io)).toEqual({ status: 403, body: { error: 'ai_not_allowed' } });
    expect(io.claimWrite).not.toHaveBeenCalled();
    expect(io.take).not.toHaveBeenCalled();
  });

  it('opens at the user’s own step-in time, not a fixed 10 pm', async () => {
    const eleven = makeIo({ profile: jest.fn(async () => ({ ai_allowed: true, ai_from_minutes: 1380 })) });
    expect(await start(eleven)).toEqual({ status: 409, body: { error: 'quiz_not_open' } }); // 10:30 pm, chosen 11 pm
    expect(eleven.claimWrite).not.toHaveBeenCalled();
    expect((await start(makeIo({ profile: jest.fn(async () => ({ ai_allowed: true, ai_from_minutes: 1350 })) }))).status).toBe(200); // chosen 10:30 pm
    expect((await start(makeIo({ profile: jest.fn(async () => ({ ai_allowed: true, ai_from_minutes: 1440 })) }))).status).toBe(409); // midnight opens at 11 pm
  });
});

describe('writing the questions', () => {
  it('claims the check-in, takes a call, asks, and saves one attempt', async () => {
    const io = makeIo();
    const result = await start(io);
    expect(result).toEqual({ status: 200, body: { step: 'answer' } });
    expect(io.claimWrite).toHaveBeenCalledWith('ci1');
    expect(io.take).toHaveBeenCalledWith('u1', 'quiz_write');
    expect(io.writeQuestions).toHaveBeenCalledWith('read', expect.stringContaining('Pride and Prejudice'), 'https://signed.example/page', []);
    expect(io.saveQuestions).toHaveBeenCalledWith('ci1', { attempts: [{ questions: QS }] });
    expect(io.release).not.toHaveBeenCalled();
  });

  it('makes one AI call when several requests arrive together: the others find the check-in claimed', async () => {
    const io = makeIo({ claimWrite: jest.fn(async () => false) });
    expect(await start(io)).toEqual({ status: 409, body: { error: 'quiz_busy' } });
    expect(io.take).not.toHaveBeenCalled();
    expect(io.writeQuestions).not.toHaveBeenCalled();
  });

  it('does not ask when the user is over their limit, and says so, on any day after the first', async () => {
    const io = makeIo({ take: jest.fn(async () => null) });
    expect(await start(io)).toEqual({ status: 429, body: { error: 'ai_limit' } });
    expect(io.firstOverLimitDay).toHaveBeenCalledWith('ch1', 3);
    expect(io.writeQuestions).not.toHaveBeenCalled();
    expect(io.releaseWrite).toHaveBeenCalledWith('ci1');
    expect(io.saveQuestions).not.toHaveBeenCalled();
  });

  it('lets the first day over the limit through: no quiz, so the day counts without one', async () => {
    const io = makeIo({ take: jest.fn(async () => null), firstOverLimitDay: jest.fn(async () => true) });
    expect(await start(io)).toEqual({ status: 200, body: { step: 'done', limited: true } });
    expect(io.writeQuestions).not.toHaveBeenCalled();
    // Saved as skipped, which also lets the writing claim go.
    expect(io.saveQuestions).toHaveBeenCalledWith('ci1', { attempts: [], skipped: true, limited: true });
  });

  it('gives the call back and lets the claim go when the AI fails, then fails as before', async () => {
    const io = makeIo({ writeQuestions: jest.fn(async () => { throw new Error('overloaded'); }) });
    await expect(start(io)).rejects.toThrow('overloaded');
    expect(io.release).toHaveBeenCalledWith(9);
    expect(io.releaseWrite).toHaveBeenCalledWith('ci1');
    expect(io.saveQuestions).not.toHaveBeenCalled();
  });

  it('skips the quiz when the AI can’t write enough it is sure of, and friends judge the photo', async () => {
    const io = makeIo({ writeQuestions: jest.fn(async () => [QS[0]]) });
    expect(await start(io)).toEqual({ status: 200, body: { step: 'done' } });
    expect(io.saveQuestions).toHaveBeenCalledWith('ci1', { attempts: [], skipped: true });
  });

  it('asks again after a failed attempt, never repeating its questions', async () => {
    const failed = attempt({ answers: ['a', 'b', 'c'], grades: ['wrong', 'wrong', 'wrong'], passed: false });
    const io = makeIo({ load: jest.fn(async () => row({ quiz: failed })) });
    expect((await start(io)).body).toEqual({ step: 'answer' });
    expect(io.writeQuestions).toHaveBeenCalledWith('read', expect.any(String), expect.anything(), QS);
  });

  it('only reports the step when there is nothing to write, with no claim and no call', async () => {
    const open = makeIo({ load: jest.fn(async () => row({ quiz: attempt() })) });
    expect(await start(open)).toEqual({ status: 200, body: { step: 'answer' } });
    expect(open.claimWrite).not.toHaveBeenCalled();
    expect(open.take).not.toHaveBeenCalled();
    expect(open.imageUrl).not.toHaveBeenCalled();
  });
});

describe('grading the answers', () => {
  const answered = () => makeIo({ load: jest.fn(async () => row({ quiz: attempt() })) });
  const send = (io: Io, answers: unknown = ['a', 'b', 'c']) => start(io, { answers });

  it('refuses answers that don’t fit the open attempt', async () => {
    for (const bad of [['a', 'b'], ['a', 'b', 'c', 'd'], 'abc', ['a', 'b', 5], ['a', 'b', 'x'.repeat(301)]]) {
      expect(await send(answered(), bad)).toEqual({ status: 400, body: { error: 'bad_answers' } });
    }
    expect((await send(makeIo(), ['a', 'b', 'c'])).status).toBe(400); // no attempt open
  });

  it('claims the answers before asking, so only the first of several sets is graded', async () => {
    const io = answered();
    io.claimAnswers.mockResolvedValue(false);
    expect(await send(io)).toEqual({ status: 409, body: { error: 'already_answered' } });
    expect(io.take).not.toHaveBeenCalled();
    expect(io.grade).not.toHaveBeenCalled();
  });

  it('takes a call, grades, saves, and approves a pass at once', async () => {
    const io = answered();
    expect(await send(io, [' a ', 'b', 'c'])).toEqual({ status: 200, body: { passed: true, step: 'done' } });
    expect(io.claimAnswers).toHaveBeenCalledWith('ci1', attempt(), attempt({ answers: ['a', 'b', 'c'] }));
    expect(io.take).toHaveBeenCalledWith('u1', 'quiz_grade');
    expect(io.saveGraded).toHaveBeenCalledWith('ci1', attempt({ answers: ['a', 'b', 'c'], grades: ['right', 'right', 'wrong'], passed: true }));
    expect(io.approve).toHaveBeenCalledWith('ci1');
  });

  it('offers one retry after a fail, and does not approve', async () => {
    const io = answered();
    io.grade.mockResolvedValue(['wrong', 'wrong', 'right']);
    expect(await send(io)).toEqual({ status: 200, body: { passed: false, step: 'retry' } });
    expect(io.approve).not.toHaveBeenCalled();
  });

  it('puts the answers back and asks for nothing when the user is over their limit, on any day after the first', async () => {
    const io = answered();
    io.take.mockResolvedValue(null);
    expect(await send(io)).toEqual({ status: 429, body: { error: 'ai_limit' } });
    expect(io.restoreQuiz).toHaveBeenCalledWith('ci1', attempt());
    expect(io.grade).not.toHaveBeenCalled();
    expect(io.saveQuestions).not.toHaveBeenCalled();
  });

  it('lets the first day over the limit through when grading is refused: the quiz is skipped, answers and all', async () => {
    const io = answered();
    io.take.mockResolvedValue(null);
    io.firstOverLimitDay.mockResolvedValue(true);
    expect(await send(io)).toEqual({ status: 200, body: { step: 'done', limited: true } });
    expect(io.grade).not.toHaveBeenCalled();
    expect(io.saveQuestions).toHaveBeenCalledWith('ci1', { ...attempt(), skipped: true, limited: true });
    expect(io.approve).not.toHaveBeenCalled();
  });

  it('gives the call back and puts the answers back when the AI fails, so the attempt opens again', async () => {
    const io = answered();
    io.grade.mockRejectedValue(new Error('overloaded'));
    await expect(send(io)).rejects.toThrow('overloaded');
    expect(io.release).toHaveBeenCalledWith(9);
    expect(io.restoreQuiz).toHaveBeenCalledWith('ci1', attempt());
    expect(io.saveGraded).not.toHaveBeenCalled();
  });

  it('treats a reply with the wrong number of gradings as unusable, so a short one can’t pass a quiz', async () => {
    const io = answered();
    io.grade.mockResolvedValue(['unsure']);
    await expect(send(io)).rejects.toThrow();
    expect(io.approve).not.toHaveBeenCalled();
    expect(io.restoreQuiz).toHaveBeenCalled();
  });
});
