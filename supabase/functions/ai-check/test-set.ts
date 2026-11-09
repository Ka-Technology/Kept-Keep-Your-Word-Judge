// T28's test set: runs each photo in a folder through the same model, prompt and rules as the
// ai-check function, as a first check (a retake still possible), and prints how many came out as
// expected, to record in SPEC-verification.md. Name each photo `<habit>--<approve|reject>--any.jpg`
// (e.g. `cook--reject--takeout.jpg`, habit ids as in rules.ts), about 1000 px like the app's. From
// the repo root, with the owner's key in the environment:
//   npx deno run --allow-env --allow-net --allow-read supabase/functions/ai-check/test-set.ts <folder>
// Each photo is one Claude Haiku 4.5 call, about $0.002.

import { Buffer } from 'node:buffer';

import { askClaude } from './index.ts';
import { checkText, outcome } from './rules.ts';

const folder = Deno.args[0];
let asExpected = 0;
let total = 0;
for await (const entry of Deno.readDir(folder)) {
  const [habit, expected] = entry.name.split('--');
  if (!entry.isFile || !/\.jpe?g$/i.test(entry.name) || !['approve', 'reject'].includes(expected)) continue;
  const data = Buffer.from(await Deno.readFile(`${folder}/${entry.name}`)).toString('base64');
  const text = checkText({ habit_id: habit, day: 1, photo_taken_at: new Date().toISOString(), time_zone: 'America/Los_Angeles', flag_note: null });
  const { verdict, reason } = await askClaude({ type: 'base64', media_type: 'image/jpeg', data }, text);
  // A retake isn't an approval: a wrong photo that gets one still counts as not approved.
  const ok = (outcome(verdict, true) === 'approved') === (expected === 'approve');
  asExpected += ok ? 1 : 0;
  total += 1;
  console.log(`${ok ? 'ok  ' : 'MISS'} ${entry.name}: ${verdict}. ${reason}`);
}
console.log(`${asExpected} of ${total} as expected`);
