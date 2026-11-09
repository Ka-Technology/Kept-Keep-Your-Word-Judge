// T42's test sets: prints the quizzes Claude Haiku 4.5 writes, with the quiz function's own prompts
// and rules, to judge and record in SPEC-verification.md. From the repo root, with the owner's key
// in the environment:
//   Books: name each last-page photo `<book>--<pages>.jpg` (e.g. `The Great Gatsby--1-20.jpg`), about
//   1000 px, then run with `books <folder>`. An obscure book should print "no quiz".
//   Languages: `languages` writes the first batch of a challenge's question bank for each of the 8 languages at each of the 3
//   levels, and prints what bank.ts would keep.
//   npx deno run --allow-env --allow-net --allow-read supabase/functions/quiz/test-set.ts books <folder>
//   npx deno run --allow-env --allow-net supabase/functions/quiz/test-set.ts languages
// A Read quiz is one Claude Haiku 4.5 call, about $0.002; a bank batch is one, about $0.02.

import { Buffer } from 'node:buffer';

import { acceptEntries, themeFor, type NewEntry } from '../_shared/bank.ts';
import { MIN_QUESTIONS, type Question } from '../_shared/quiz.ts';
import { aboutText, writeBank, writeQuestions } from './index.ts';

function show(title: string, questions: Question[]) {
  console.log(`\n${title}`);
  if (questions.length < MIN_QUESTIONS) return console.log('  no quiz: friends judge the photo instead');
  for (const q of questions) console.log(`  [${q.kind}] ${q.prompt}${q.speak ? `  (read aloud: “${q.speak}”)` : ''}`);
}

function showBank(title: string, entries: NewEntry[]) {
  console.log(`
${title}: ${entries.length} questions kept`);
  for (const e of entries) console.log(`  [${e.kind}] ${e.prompt}  -> ${[e.answer, ...e.accepted].join(' | ')}  {${e.tags.join(', ')}}`);
}

const [mode, folder] = Deno.args;
if (mode === 'books') {
  for await (const entry of Deno.readDir(folder)) {
    if (!entry.isFile || !/\.jpe?g$/i.test(entry.name)) continue;
    const [book, pages = ''] = entry.name.replace(/\.jpe?g$/i, '').split('--');
    const data = Buffer.from(await Deno.readFile(`${folder}/${entry.name}`)).toString('base64');
    show(`${book}, pages ${pages}`, await writeQuestions('read', aboutText('read', { book, pages }), { type: 'base64', media_type: 'image/jpeg', data }, []));
  }
} else if (mode === 'languages') {
  for (const language of ['spanish', 'french', 'german', 'italian', 'portuguese', 'japanese', 'korean', 'mandarin']) {
    for (const level of ['beginner', 'intermediate', 'advanced']) {
      showBank(`${language}, ${level}`, acceptEntries(await writeBank({ language, level, theme: themeFor(0), avoid: [] }), new Set()));
    }
  }
} else {
  console.log('Usage: test-set.ts books <folder> | test-set.ts languages');
}
