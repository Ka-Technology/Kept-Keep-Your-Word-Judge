// Nothing else reads the edge functions before a deploy: tsc leaves them out, and their tests import only their rules.
// So `const key` written twice in two-step-recover's index.ts (2026-11-06) passed everything, and took the function
// down with BOOT_ERROR once it was deployed.

import { parse } from '@babel/parser';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sources = readdirSync(__dirname, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

it.each(sources)('%s parses', (file) => {
  expect(() => parse(readFileSync(join(__dirname, file), 'utf8'), { sourceType: 'module', plugins: ['typescript'] })).not.toThrow();
});
