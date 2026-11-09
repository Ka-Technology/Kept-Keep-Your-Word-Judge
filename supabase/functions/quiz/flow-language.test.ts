// Unit tests for the language quiz's part of flow.ts: questions drawn from a per-challenge bank, the AI asked only
// to top the bank up and to judge answers Kept can't (plan.md decision 180, T246). Every dependency is injected.
import { themeFor, type BankEntry, type NewEntry, type WrittenEntry } from '../_shared/bank';
import type { Grade, Question, Quiz } from '../_shared/quiz';
import { runQuiz, type Io, type Row } from './flow';

// 10:30 pm on Sep 29 in Los Angeles (UTC-7).
const NOW = new Date('2026-09-30T05:30:00Z');
const KINDS = ['vocabulary', 'sentence', 'reading', 'listening'];

/** An unused bank entry: kind cycles through the four, `answer i` is its answer. */
function entry(i: number, over: Partial<BankEntry> = {}): BankEntry {
  const kind = KINDS[i % 4];
  return { id: `b${i}`, key: `word${i}`, kind, prompt: `Translate: thing ${i}`, speak: kind === 'listening' ? `phrase ${i}` : null, answer: `answer ${i}`, accepted: [], tags: [], batch: 0, usedAt: null, ...over };
}
const entries = (n: number, over: (i: number) => Partial<BankEntry> = () => ({})) => Array.from({ length: n }, (_, i) => entry(i, over(i)));

/** A batch as the AI writes it. */
function batch(n: number, from = 100): WrittenEntry[] {
  return Array.from({ length: n }, (_, i) => {
    const kind = KINDS[i % 4];
    return { key: `new${from + i}`, kind, prompt: `Translate: new ${from + i}`, speak: kind === 'listening' ? `new phrase ${from + i}` : null, answer: `new answer ${from + i}`, accepted: [], tags: ['food'], sure: true };
  });
}

/** A bank that remembers: what is added and used shows in the next list. */
function makeBank(start: BankEntry[], write: () => Promise<WrittenEntry[]> = async () => batch(40)) {
  const state = { entries: [...start] };
  return {
    state,
    list: jest.fn(async () => state.entries.map((e) => ({ ...e }))),
    add: jest.fn(async (_challenge: string, b: number, fresh: NewEntry[]) => {
      fresh.forEach((e, i) => state.entries.push({ ...e, id: `n${b}-${i}`, batch: b, usedAt: null }));
    }),
    use: jest.fn(async (ids: string[]) => {
      state.entries = state.entries.map((e) => (ids.includes(e.id) ? { ...e, usedAt: 'used' } : e));
    }),
    write: jest.fn(write),
  };
}

function lang(over: Partial<Row> = {}): Row {
  return {
    id: 'ci1',
    status: 'pending',
    book: null,
    pages: null,
    photo_path: null,
    quiz: null,
    day: 3,
    challenges: { id: 'ch1', habit_id: 'language', language: 'spanish', level: 'beginner', time_zone: 'America/Los_Angeles', length_days: 28 },
    ...over,
  };
}

function makeIo(bank: ReturnType<typeof makeBank>, over: Partial<Io> = {}) {
  const io = {
    load: jest.fn(async (): Promise<Row | null> => lang()),
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
    writeQuestions: jest.fn(async (): Promise<Question[]> => []),
    grade: jest.fn(async (): Promise<Grade[]> => []),
    log: jest.fn(),
    bank,
    ...over,
  };
  return io as typeof io & Io;
}

const first = () => 0;
const start = (io: Io, over: Partial<Parameters<typeof runQuiz>[0]> = {}) => runQuiz({ user: 'u1', checkInId: 'ci1', now: NOW, random: first, ...over }, io);
/** The questions of the last quiz saved. */
const saved = (io: { saveQuestions: jest.Mock }): Question[] => (io.saveQuestions.mock.calls.at(-1)![1] as Quiz).attempts.at(-1)!.questions;

describe('a day’s questions come from the bank', () => {
  it('draws them, one of each kind in order, without asking the AI when the bank has enough', async () => {
    const io = makeIo(makeBank(entries(40)));
    expect(await start(io)).toEqual({ status: 200, body: { step: 'answer' } });
    expect(saved(io).map((q) => q.kind)).toEqual(KINDS);
    expect(io.take).not.toHaveBeenCalled();
    expect(io.bank.write).not.toHaveBeenCalled();
    expect(io.writeQuestions).not.toHaveBeenCalled();
  });

  it('marks what it drew as used, and keeps only the bank row’s id with each question, never an answer', async () => {
    const io = makeIo(makeBank(entries(40)));
    await start(io);
    const questions = saved(io);
    expect(io.bank.use).toHaveBeenCalledWith(questions.map((q) => q.bank));
    expect(questions.every((q) => typeof q.bank === 'string')).toBe(true);
    expect(JSON.stringify(io.saveQuestions.mock.calls)).not.toMatch(/answer \d/);
  });

  it('never asks a word twice across a challenge’s days, and a retry the same day brings four new ones', async () => {
    const bank = makeBank(entries(40));
    const seen: string[] = [];
    for (let day = 1; day <= 5; day++) {
      const io = makeIo(bank, { load: jest.fn(async () => lang({ day })) });
      await start(io, { random: Math.random });
      seen.push(...saved(io).map((q) => bank.state.entries.find((e) => e.id === q.bank)!.key));
    }
    // A failed first attempt today, then its retry.
    const failed: Quiz = { attempts: [{ questions: [{ kind: 'vocabulary', prompt: 'x', bank: 'b0' }], answers: ['n'], grades: ['wrong'], passed: false }] };
    const retry = makeIo(bank, { load: jest.fn(async () => lang({ day: 6, quiz: failed })) });
    await start(retry, { random: Math.random });
    seen.push(...saved(retry).map((q) => bank.state.entries.find((e) => e.id === q.bank)!.key));
    expect(seen).toHaveLength(24);
    expect(new Set(seen).size).toBe(24);
  });

  it('follows the day’s note in about half the questions, and asks the AI nothing when the bank already has it', async () => {
    const all = entries(40, (i) => ({ tags: i === 4 || i === 6 ? ['restaurant'] : ['weather'] }));
    const io = makeIo(makeBank(all));
    await start(io, { note: 'ordering at a restaurant' });
    expect(saved(io).map((q) => q.bank)).toEqual(['b4', 'b1', 'b6', 'b3']);
    expect(io.bank.write).not.toHaveBeenCalled();
    expect(io.take).not.toHaveBeenCalled();
  });
});

describe('the note and the AI (owner, 2026-11-03: the AI gets the note when it writes a batch)', () => {
  it('tells the AI the note when it tops the bank up anyway', async () => {
    const bank = makeBank(entries(40, (i) => ({ usedAt: i < 30 ? 'used' : null, tags: ['zebra'] })));
    const io = makeIo(bank);
    await start(io, { note: 'a zebra at the cafe' });
    expect(bank.write).toHaveBeenCalledTimes(1);
    expect(bank.write).toHaveBeenCalledWith(expect.objectContaining({ note: 'a zebra at the cafe' }));
    expect(saved(io)).toHaveLength(4);
  });

  it('writes a batch about a note the bank has nothing on: one call, with the note', async () => {
    const bank = makeBank(entries(40, () => ({ tags: ['weather'] })));
    const io = makeIo(bank);
    await start(io, { note: 'ordering at a restaurant' });
    expect(io.take).toHaveBeenCalledTimes(1);
    expect(io.take).toHaveBeenCalledWith('u1', 'bank');
    expect(bank.write).toHaveBeenCalledWith(expect.objectContaining({ note: 'ordering at a restaurant', theme: themeFor(1) }));
    expect(saved(io)).toHaveLength(4);
  });

  it('follows the note from the new batch, whose tags the AI wrote', async () => {
    const bank = makeBank(entries(40, () => ({ tags: ['weather'] })), async () => batch(40).map((e) => ({ ...e, tags: ['restaurant', 'food'] })));
    const io = makeIo(bank);
    await start(io, { note: 'ordering at a restaurant' });
    expect(saved(io).filter((q) => q.bank?.startsWith('n1-'))).toHaveLength(2);
  });

  it('never writes a note batch past the third batch of a challenge', async () => {
    const bank = makeBank(entries(40, (i) => ({ tags: ['weather'], batch: i % 3 })));
    const io = makeIo(bank);
    await start(io, { note: 'ordering at a restaurant' });
    expect(bank.write).not.toHaveBeenCalled();
    expect(io.take).not.toHaveBeenCalled();
    expect(saved(io)).toHaveLength(4);
  });

  it('carries on from the bank when the user has no call left for a note batch', async () => {
    const bank = makeBank(entries(40, () => ({ tags: ['weather'] })));
    const io = makeIo(bank, { take: jest.fn(async () => null) });
    expect(await start(io, { note: 'ordering at a restaurant' })).toEqual({ status: 200, body: { step: 'answer' } });
    expect(bank.write).not.toHaveBeenCalled();
    expect(saved(io)).toHaveLength(4);
  });

  it('asks nothing extra for a note of only filler words', async () => {
    const bank = makeBank(entries(40, () => ({ tags: ['weather'] })));
    const io = makeIo(bank);
    await start(io, { note: 'just practiced today' });
    expect(bank.write).not.toHaveBeenCalled();
  });
});

describe('topping the bank up (the AI’s only part in writing a language quiz)', () => {
  it('asks for a new batch when the bank runs low: one call, told the words already in it and a new theme', async () => {
    const bank = makeBank(entries(40, (i) => ({ usedAt: i < 30 ? 'used' : null, batch: 0 })));
    const io = makeIo(bank);
    await start(io);
    expect(io.take).toHaveBeenCalledTimes(1);
    expect(io.take).toHaveBeenCalledWith('u1', 'bank');
    expect(bank.write).toHaveBeenCalledWith({ language: 'spanish', level: 'beginner', theme: themeFor(1), avoid: entries(40).map((e) => e.key), note: null });
    expect(bank.add).toHaveBeenCalledWith('ch1', 1, expect.any(Array));
    expect(bank.add.mock.calls[0][2]).toHaveLength(40);
    expect(saved(io)).toHaveLength(4);
  });

  it('writes the first batch for an empty bank, with the first theme', async () => {
    const bank = makeBank([]);
    const io = makeIo(bank);
    expect(await start(io)).toEqual({ status: 200, body: { step: 'answer' } });
    expect(bank.write).toHaveBeenCalledWith(expect.objectContaining({ theme: themeFor(0), avoid: [] }));
    expect(bank.add).toHaveBeenCalledWith('ch1', 0, expect.any(Array));
  });

  it('needs no new batch near the end of a challenge, when the bank covers the days left', async () => {
    const io = makeIo(makeBank(entries(40, (i) => ({ usedAt: i < 30 ? 'used' : null }))), { load: jest.fn(async () => lang({ day: 28 })) });
    await start(io);
    expect(io.take).not.toHaveBeenCalled();
  });

  it('carries on from what the bank has when the user is over their limit', async () => {
    const bank = makeBank(entries(40, (i) => ({ usedAt: i < 30 ? 'used' : null })));
    const io = makeIo(bank, { take: jest.fn(async () => null) });
    expect(await start(io)).toEqual({ status: 200, body: { step: 'answer' } });
    expect(bank.write).not.toHaveBeenCalled();
    expect(io.firstOverLimitDay).not.toHaveBeenCalled();
  });

  it('carries on from the bank, and gives the call back, when the AI fails', async () => {
    const bank = makeBank(entries(40, (i) => ({ usedAt: i < 30 ? 'used' : null })), async () => { throw new Error('overloaded'); });
    const io = makeIo(bank);
    expect(await start(io)).toEqual({ status: 200, body: { step: 'answer' } });
    expect(io.release).toHaveBeenCalledWith(9);
  });

  it('fails, giving back the call and the claim, when the bank is empty and the AI fails', async () => {
    const io = makeIo(makeBank([], async () => { throw new Error('overloaded'); }));
    await expect(start(io)).rejects.toThrow('overloaded');
    expect(io.release).toHaveBeenCalledWith(9);
    expect(io.releaseWrite).toHaveBeenCalledWith('ci1');
    expect(io.saveQuestions).not.toHaveBeenCalled();
  });

  it('skips the quiz when the AI’s batch has nothing usable, and friends judge', async () => {
    const io = makeIo(makeBank([], async () => batch(40).map((w) => ({ ...w, sure: false }))));
    expect(await start(io)).toEqual({ status: 200, body: { step: 'done' } });
    expect(io.saveQuestions).toHaveBeenCalledWith('ci1', { attempts: [], skipped: true });
  });

  it('with an empty bank and no calls left: the first day over the limit has no quiz, a later one is told the limit', async () => {
    const empty = () => makeIo(makeBank([]), { take: jest.fn(async () => null) });
    const pass = empty();
    pass.firstOverLimitDay.mockResolvedValue(true);
    expect(await start(pass)).toEqual({ status: 200, body: { step: 'done', limited: true } });
    expect(pass.saveQuestions).toHaveBeenCalledWith('ci1', { attempts: [], skipped: true, limited: true });
    const miss = empty();
    expect(await start(miss)).toEqual({ status: 429, body: { error: 'ai_limit' } });
    expect(miss.releaseWrite).toHaveBeenCalledWith('ci1');
  });
});

describe('grading a language attempt: Kept first, the AI last', () => {
  const questions: Question[] = [0, 1, 2, 3].map((i) => ({ kind: KINDS[i], prompt: `Translate: thing ${i}`, speak: i === 3 ? 'phrase 3' : null, bank: `b${i}` }));
  // A fresh quiz each time: the flow writes the answers into the one it loads.
  const open = (): Quiz => ({ attempts: [{ questions: questions.map((q) => ({ ...q })) }] });
  const answered = (bank = makeBank(entries(8)), over: Partial<Io> = {}) => makeIo(bank, { load: jest.fn(async () => lang({ quiz: open() })), ...over });
  const send = (io: Io, answers: string[]) => start(io, { answers });

  it('asks the AI nothing when every answer matches or is blank, and passes', async () => {
    const io = answered();
    expect(await send(io, ['answer 0', 'ANSWER 1', 'answer 2', 'answer 3'])).toEqual({ status: 200, body: { passed: true, step: 'done' } });
    expect(io.take).not.toHaveBeenCalled();
    expect(io.grade).not.toHaveBeenCalled();
    expect(io.approve).toHaveBeenCalledWith('ci1');
    const blank = answered();
    expect((await send(blank, ['', ' ', '', ''])).body).toMatchObject({ passed: false, step: 'retry' });
    expect(blank.take).not.toHaveBeenCalled();
  });

  it('asks the AI once, about only the answers that match nothing, and puts the grades back in order', async () => {
    const io = answered();
    io.grade.mockResolvedValue(['unsure']);
    const result = await send(io, ['answer 0', 'a fair answer', 'answer 2', 'answer 3']);
    expect(result).toEqual({ status: 200, body: { passed: true, step: 'done' } });
    expect(io.take).toHaveBeenCalledTimes(1);
    expect(io.take).toHaveBeenCalledWith('u1', 'quiz_grade');
    expect(io.grade).toHaveBeenCalledTimes(1);
    const [text] = io.grade.mock.calls[0] as unknown as [string];
    expect(text).toContain('thing 1');
    expect(text).toContain('a fair answer');
    expect(text).not.toContain('thing 0');
    expect(text).not.toContain('thing 2');
    expect(io.saveGraded.mock.calls[0][1].attempts[0].grades).toEqual(['right', 'unsure', 'right', 'right']);
  });

  it('grades a quiz from before the bank (no bank ids) entirely by the AI, as it always was', async () => {
    const old: Quiz = { attempts: [{ questions: questions.map(({ bank: _bank, ...q }) => q) }] };
    const io = answered(makeBank(entries(8)), { load: jest.fn(async () => lang({ quiz: old })) });
    io.grade.mockResolvedValue(['right', 'right', 'right', 'wrong']);
    await send(io, ['a', 'b', 'c', 'd']);
    const [text] = io.grade.mock.calls[0] as unknown as [string];
    expect(text).toContain('thing 0');
    expect(text).toContain('thing 3');
  });

  it('never sends a photo for Learn a language, whatever the check-in holds', async () => {
    const io = answered(makeBank(entries(8)), { load: jest.fn(async () => lang({ quiz: open(), photo_path: 'u1/ch1/3-1.jpg' })) });
    io.grade.mockResolvedValue(['right']);
    await send(io, ['answer 0', 'x', 'answer 2', 'answer 3']);
    expect(io.imageUrl).not.toHaveBeenCalled();
    expect(io.grade).toHaveBeenCalledWith(expect.any(String), null);
  });

  it('keeps the attempt open, with the call given back, when the AI’s share fails', async () => {
    const io = answered();
    io.grade.mockRejectedValue(new Error('overloaded'));
    await expect(send(io, ['answer 0', 'x', 'answer 2', 'answer 3'])).rejects.toThrow('overloaded');
    expect(io.release).toHaveBeenCalledWith(9);
    expect(io.restoreQuiz).toHaveBeenCalled();
  });

  it('refuses an AI reply that doesn’t grade each answer it was sent', async () => {
    const io = answered();
    io.grade.mockResolvedValue([]);
    await expect(send(io, ['answer 0', 'x', 'y', 'answer 3'])).rejects.toThrow();
    expect(io.approve).not.toHaveBeenCalled();
  });

  it('when the AI’s share is over the user’s limit: the first day passes, a later one is told', async () => {
    const pass = answered(makeBank(entries(8)), { take: jest.fn(async () => null), firstOverLimitDay: jest.fn(async () => true) });
    expect(await send(pass, ['answer 0', 'x', 'answer 2', 'answer 3'])).toEqual({ status: 200, body: { step: 'done', limited: true } });
    const miss = answered(makeBank(entries(8)), { take: jest.fn(async () => null) });
    expect(await send(miss, ['answer 0', 'x', 'answer 2', 'answer 3'])).toEqual({ status: 429, body: { error: 'ai_limit' } });
    expect(miss.grade).not.toHaveBeenCalled();
  });
});
