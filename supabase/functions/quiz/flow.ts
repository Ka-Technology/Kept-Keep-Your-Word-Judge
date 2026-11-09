// The AI pop quiz's flow (T42, SPEC-verification.md; plan.md decision 180, T245-T246), with everything outside it
// injected (`Io`), so Jest tries every path without a network (flow.test.ts, flow-language.test.ts); index.ts
// supplies the real ones. The AI is a last resort behind a per-user ceiling, and nothing is asked of it before
// a claim: writing the questions claims the check-in (one writer at a time, so simultaneous requests make one
// AI call and a slow one can't overwrite a quiz that was answered), and grading claims the answers (so nobody
// gets more than one guess per attempt: security review, 2026-10-01). Each AI call takes one of the user's calls
// first and gives it back when Kept itself fails; a user with none left gets no quiz on their first such day in
// a challenge (it counts without one), and is told the limit was reached on any day after it.
// Read: the AI writes the questions from the page photo and grades the answers. Learn a language: the questions
// are drawn from a bank written for the challenge in batches (the AI's only part in writing), and Kept grades
// an answer itself when it can; only what matches nothing goes to the AI, in one call.

import type { CallKind } from '../_shared/ai-calls.ts';
import { acceptEntries, drawQuestions, localGrades, mergeGrades, needsTopUp, noteNeedsBatch, themeFor, type BankEntry, type NewEntry, type WrittenEntry } from '../_shared/bank.ts';
import { MIN_QUESTIONS, nextStep, passes, QUESTIONS, quizOpen, type Grade, type Question, type Quiz } from '../_shared/quiz.ts';

export type Row = {
  id: string;
  status: string;
  book: string | null;
  pages: string | null;
  photo_path: string | null;
  quiz: Quiz | null;
  /** The challenge's day this check-in is for. */
  day: number;
  challenges: { id: string; habit_id: string; language: string | null; level: string | null; time_zone: string; length_days: number };
};

export type Io = {
  /** The user's own check-in, or null. */
  load(checkInId: string, user: string): Promise<Row | null>;
  profile(user: string): Promise<{ ai_allowed: boolean | null; ai_from_minutes: number }>;
  /** A short-lived link to the check-in's photo. */
  imageUrl(path: string): Promise<string>;
  /** Claims the check-in for writing its questions: false when another request holds it. */
  claimWrite(id: string): Promise<boolean>;
  /** Saves the quiz and lets the writing claim go (only while the check-in is still pending). */
  saveQuestions(id: string, quiz: Quiz): Promise<void>;
  /** Lets the writing claim go without changing the quiz. */
  releaseWrite(id: string): Promise<void>;
  /** Saves `after` only if the quiz is still exactly `before`: false when another request got there first. */
  claimAnswers(id: string, before: Quiz, after: Quiz): Promise<boolean>;
  /** Puts the quiz back as it was, so the attempt opens again. */
  restoreQuiz(id: string, before: Quiz): Promise<void>;
  saveGraded(id: string, quiz: Quiz): Promise<void>;
  /** A pass approves the check-in at once; a friend who approved first wins. */
  approve(id: string): Promise<void>;
  take(user: string, kind: CallKind): Promise<number | null>;
  release(call: number): Promise<void>;
  /** Whether this day is the challenge's first one the AI couldn't help with (it passes; any later one is a miss). */
  firstOverLimitDay(challenge: string, day: number): Promise<boolean>;
  /** Read's next attempt: questions from the page photo, never repeating `earlier`. */
  writeQuestions(habit: string, about: string, image: string | null, earlier: Question[]): Promise<Question[]>;
  /** One grading for each question in `text` (what the quiz is about and each answer to judge). */
  grade(text: string, image: string | null): Promise<Grade[]>;
  /** A challenge's language question bank (server only: it holds the right answers). */
  bank: {
    list(challenge: string): Promise<BankEntry[]>;
    add(challenge: string, batch: number, entries: NewEntry[]): Promise<void>;
    use(ids: string[]): Promise<void>;
    /** The AI writes a batch of questions on a theme, avoiding the words already in the bank. */
    write(input: { language: string; level: string; theme: string; avoid: string[]; note?: string | null }): Promise<WrittenEntry[]>;
  };
  /** The verdict log, without personal data (SPEC.md open question 8). */
  log(entry: Record<string, unknown>): void;
};

export type Result = { status: number; body: Record<string, unknown> };

/** What the quiz is about: the book and pages (Read), or the language and level. */
export function aboutText(habit: string, c: { book?: string | null; pages?: string | null; language?: string | null; level?: string | null }): string {
  return habit === 'read' ? `Book: ${JSON.stringify(c.book)}\nPages read: ${JSON.stringify(c.pages)}` : `Language: ${c.language}. Level: ${c.level}.`;
}

/** The day's note is a few words, not a story. */
const NOTE_MAX = 100;

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** The questions in `indexes`, numbered from 1, each with its answer as a JSON string: the learner's words to judge, never instructions. */
function attemptText(questions: Question[], answers: string[], indexes: number[]): string {
  return indexes
    .map((qi, n) => `${n + 1}. ${questions[qi].prompt}${questions[qi].speak ? ` (the phrase read aloud: “${questions[qi].speak}”)` : ''}\n   Answer: ${JSON.stringify(answers[qi])}`)
    .join('\n');
}

export async function runQuiz(
  input: { user: string; checkInId: string; answers?: unknown; note?: unknown; now: Date; random?: () => number },
  io: Io,
): Promise<Result> {
  const { user } = input;
  const row = await io.load(input.checkInId, user);
  if (!row) return { status: 404, body: { error: 'not_found' } };
  const habit = row.challenges.habit_id;
  if (!QUESTIONS[habit] || row.status !== 'pending') return { status: 409, body: { error: 'no_quiz' } };

  // Nothing goes to Kept's AI unless the challenger allowed it (T54, profiles.ai_allowed).
  const profile = await io.profile(user);
  if (profile.ai_allowed !== true) return { status: 403, body: { error: 'ai_not_allowed' } };

  const quiz: Quiz = row.quiz ?? { attempts: [] };
  const step = nextStep(row.quiz);
  const about = aboutText(habit, { ...row, ...row.challenges });
  // Only Read has a page photo to look at.
  const image = () => (habit === 'read' && row.photo_path ? io.imageUrl(row.photo_path) : Promise.resolve(null));

  /**
   * The user has no AI call left for something the quiz can't do without. The first such day in a challenge
   * passes: the quiz is saved as skipped (which also lets a writing claim go) and the day counts without one.
   * Any later one is told the limit was reached, and is a miss the user can appeal.
   */
  async function limited(saved: Quiz, undo: () => Promise<void>): Promise<Result> {
    if (await io.firstOverLimitDay(row!.challenges.id, row!.day)) {
      await io.saveQuestions(row!.id, { ...saved, skipped: true, limited: true });
      return { status: 200, body: { step: 'done', limited: true } };
    }
    await undo();
    return { status: 429, body: { error: 'ai_limit' } };
  }

  if (input.answers === undefined) {
    if (step !== 'start' && step !== 'retry') return { status: 200, body: { step } };
    // Friends get the first chance: new questions only from the user's step-in time (10 pm unless they chose later).
    if (!quizOpen(input.now, row.challenges.time_zone, profile.ai_from_minutes)) return { status: 409, body: { error: 'quiz_not_open' } };
    if (!(await io.claimWrite(row.id))) return { status: 409, body: { error: 'quiz_busy' } };
    let call: number | null = null;
    try {
      let questions: Question[] = [];
      let refused = false;
      if (habit === 'language') {
        ({ questions, refused } = await fromBank(row, user, io, typeof input.note === 'string' ? input.note.trim().slice(0, NOTE_MAX) : null, input.random ?? Math.random));
      } else {
        call = await io.take(user, 'quiz_write');
        if (call === null) refused = true;
        else questions = await io.writeQuestions(habit, about, await image(), quiz.attempts.flatMap((a) => a.questions));
      }
      if (refused && questions.length < MIN_QUESTIONS) return await limited(quiz, () => io.releaseWrite(row.id));
      if (questions.length < MIN_QUESTIONS) quiz.skipped = true;
      else quiz.attempts.push({ questions });
      await io.saveQuestions(row.id, quiz);
      return { status: 200, body: { step: nextStep(quiz) } };
    } catch (e) {
      // Kept's failure, not the user's: the call and the claim go back.
      if (call !== null) await io.release(call).catch(() => {});
      await io.releaseWrite(row.id).catch(() => {});
      throw e;
    }
  }

  // Grading the open attempt.
  const answers = input.answers;
  const open = quiz.attempts.at(-1);
  if (step !== 'answer' || !open || !Array.isArray(answers) || answers.length !== open.questions.length || answers.some((a) => typeof a !== 'string' || a.length > 300)) {
    return { status: 400, body: { error: 'bad_answers' } };
  }
  const before = copy(quiz);
  open.answers = (answers as string[]).map((a) => a.trim());
  if (!(await io.claimAnswers(row.id, before, copy(quiz)))) return { status: 409, body: { error: 'already_answered' } };

  // Kept grades what it can by the bank's stored answers; only the rest is the AI's, in one call.
  const byId = new Map<string, BankEntry>();
  if (habit === 'language' && open.questions.some((q) => q.bank)) for (const e of await io.bank.list(row.challenges.id)) byId.set(e.id, e);
  const own = localGrades(open.answers, open.questions.map((q) => (q.bank ? byId.get(q.bank) : undefined)));
  const needed = own.flatMap((g, i) => (g === null ? [i] : []));

  let grades: Grade[];
  if (needed.length === 0) {
    grades = own as Grade[];
  } else {
    const call = await io.take(user, 'quiz_grade');
    if (call === null) return await limited(before, () => io.restoreQuiz(row.id, before));
    try {
      // One grading for each answer sent, or the reply is unusable (review, 2026-10-04: a short reply padded with
      // "unsure" could pass a quiz in which no answer was right).
      grades = mergeGrades(own, await io.grade(`${about}\n\n${attemptText(open.questions, open.answers, needed)}`, await image()));
    } catch (e) {
      // Kept's failure, not the challenger's: the call goes back and the attempt opens again for their answers.
      await io.release(call).catch(() => {});
      await io.restoreQuiz(row.id, before);
      throw e;
    }
  }
  open.grades = grades;
  open.passed = passes(habit, grades);
  await io.saveGraded(row.id, quiz);
  if (open.passed) await io.approve(row.id);
  io.log({ habit, quiz_attempt: quiz.attempts.length, grades, passed: open.passed });
  return { status: 200, body: { passed: open.passed, step: nextStep(quiz) } };
}

/**
 * Learn a language: the day's questions from the challenge's bank, which the AI tops up (one call, told the
 * words already in it and a new theme) only when it is running low and the user has a call left. A top-up that
 * is refused or fails costs the quiz nothing while the bank can still give one; `refused` says the user's limit
 * was why, so a bank with nothing to ask is the limit's doing and not Kept's. The day's note steers the draw and, when a batch is written, goes to the AI with it (never stored).
 */
async function fromBank(row: Row, user: string, io: Io, note: string | null, random: () => number): Promise<{ questions: Question[]; refused: boolean }> {
  const challenge = row.challenges;
  let bank = await io.bank.list(challenge.id);
  const unused = () => bank.filter((e) => e.usedAt === null).length;
  let refused = false;
  // A note the bank has nothing on earns a batch too (owner, 2026-11-03), up to three in all, and the AI gets the note with it.
  const batches = new Set(bank.map((e) => e.batch)).size;
  if (needsTopUp(unused(), challenge.length_days - row.day + 1) || noteNeedsBatch(note, bank.filter((e) => e.usedAt === null), batches)) {
    const call = await io.take(user, 'bank');
    if (call === null) {
      refused = true;
    } else {
      try {
        const next = bank.reduce((most, e) => Math.max(most, e.batch), -1) + 1;
        const written = await io.bank.write({ language: challenge.language ?? '', level: challenge.level ?? '', theme: themeFor(next), avoid: bank.map((e) => e.key), note });
        await io.bank.add(challenge.id, next, acceptEntries(written, new Set(bank.map((e) => e.key))));
        bank = await io.bank.list(challenge.id);
      } catch (e) {
        await io.release(call).catch(() => {});
        if (unused() < MIN_QUESTIONS) throw e;
      }
    }
  }
  const drawn = drawQuestions(bank, note, random);
  if (drawn.length < MIN_QUESTIONS) return { questions: [], refused };
  await io.bank.use(drawn.map((e) => e.id));
  return { questions: drawn.map((e) => ({ kind: e.kind, prompt: e.prompt, speak: e.speak, bank: e.id })), refused };
}
