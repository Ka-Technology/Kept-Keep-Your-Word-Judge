// The quiz rules (T42, SPEC-verification.md), shared by the quiz Edge Function, ai-check's deadline
// decision and the app (the check-in and review screens). No imports, so Deno, jest and the app all
// load it (tested in quiz.test.ts).

/** How the AI graded one answer. A grading it wasn't sure of never counts as wrong. */
export type Grade = 'right' | 'wrong' | 'unsure';

/**
 * One question, stored on the check-in, which the app can read, so there's never an answer key: the
 * AI grades from the question (and, for Read, the page). `speak` is the phrase the phone reads aloud
 * for a listening question; the app never shows it.
 */
export type Question = { kind: string; prompt: string; speak?: string | null; /** The language bank's row for it, so the server can grade by its stored answer (an id, never an answer). */ bank?: string };

export type Attempt = { questions: Question[]; answers?: string[]; grades?: Grade[]; passed?: boolean };

/**
 * `check_ins.quiz`. `skipped`: there is no quiz for this day, so friends judge the photo, or the day counts without one.
 * `limited`: it was skipped because the user had no AI call left (the one free pass a challenge gets), not because the AI
 * couldn't write enough questions it was sure of (an unknown book).
 */
export type Quiz = { attempts: Attempt[]; skipped?: boolean; limited?: boolean };

/** Questions asked per quiz, and right answers that pass (SPEC-verification.md): Read 2 of 3, Learn a language 3 of 4. */
export const QUESTIONS: Record<string, number> = { read: 3, language: 4 };
const TO_PASS: Record<string, number> = { read: 2, language: 3 };

/** Fewer questions the AI is sure of than this, and there's no quiz. */
export const MIN_QUESTIONS = 2;

/** Friends get the first chance: the quiz opens at 10 pm in the challenge's zone (owner, 2026-09-27), in minutes since midnight. */
const QUIZ_OPENS_AT = 22 * 60;
/** The latest it opens, whatever the user chose, so a quiz always has an hour to take (ai-limit.ts quizOpensAt() says the same). */
const QUIZ_LATEST = 23 * 60;

/** Minutes since midnight at `now` in `timeZone` (0 to 1439). */
export function localMinutes(now: Date, timeZone: string): number {
  const [hour, minute] = now.toLocaleString('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: false }).split(':');
  // `% 24`: some engines write midnight as hour 24.
  return (Number(hour) % 24) * 60 + Number(minute);
}

/**
 * Whether the quiz is open at `now`: from the user's step-in time (10 pm unless they chose later in Settings,
 * `fromMinutes`; plan.md decision 180) until midnight in the challenge's time zone.
 */
export function quizOpen(now: Date, timeZone: string, fromMinutes = QUIZ_OPENS_AT): boolean {
  return localMinutes(now, timeZone) >= Math.min(fromMinutes, QUIZ_LATEST);
}

/** Whether the answers pass. Only the questions kept count, so with fewer of them, fewer right answers are needed. */
export function passes(habitId: string, grades: Grade[]): boolean {
  // An unsure grading never counts against anyone, but fills one slot at most: answers written to talk
  // the grader into "unsure" can't pass a quiz on their own (review, 2026-10-04).
  const right = grades.filter((g) => g === 'right').length + Math.min(1, grades.filter((g) => g === 'unsure').length);
  return right >= Math.min(TO_PASS[habitId], grades.length);
}

/** The questions minus any asked in an earlier attempt, compared ignoring case, spaces and punctuation. */
export function withoutRepeats(questions: Question[], earlier: Question[]): Question[] {
  const key = (q: Question) => q.prompt.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const asked = new Set(earlier.map(key));
  return questions.filter((q) => !asked.has(key(q)));
}

/** Words only: lowercase, without accents or punctuation, padded with spaces so whole words match. */
const words = (s: string) => ` ${s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/**
 * Whether a question gives itself away: its answer, or a listening question's phrase read aloud,
 * written in the prompt ("Translate 'the cat' (el gato)"). A reading question's passage holds its
 * answer by design, so only its phrase is checked. `answer` is the AI's own, never kept.
 */
// ponytail: whole words only, so a giveaway run into Japanese or Chinese text with no space or punctuation slips through.
export function givesAway(q: Question, answer: string): boolean {
  const prompt = words(q.prompt);
  return [q.kind === 'reading' ? '' : answer, q.speak ?? ''].some((hidden) => words(hidden).trim() !== '' && prompt.includes(words(hidden)));
}

/** What the challenger can do next: start the quiz, answer the open attempt, retry once after a fail, or nothing. */
export function nextStep(quiz: Quiz | null | undefined): 'start' | 'answer' | 'retry' | 'done' {
  if (!quiz) return 'start';
  const last = quiz.attempts.at(-1);
  if (quiz.skipped || !last || last.passed) return 'done';
  if (!last.answers) return 'answer';
  return quiz.attempts.length === 1 ? 'retry' : 'done';
}

/** The quiz as text: each attempt's questions, answers and gradings, for the AI's deadline decision. */
export function quizText(quiz: Quiz): string {
  return quiz.attempts
    .filter((a) => a.answers)
    .map((a, i) => `Attempt ${i + 1}:\n` + a.questions.map((q, j) => `- ${q.prompt} → ${JSON.stringify(a.answers![j] ?? '')} (${a.grades?.[j] ?? 'not graded'})`).join('\n'))
    .join('\n');
}
