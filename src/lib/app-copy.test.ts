/// <reference types="node" />
// No pretend-money or demo wording where people read it (plan.md decision 139; T212): every screen and component is
// scanned with its comments taken out. Decision 139 keeps the developer-only "Next day (demo)" and the version's
// "(demo)", which these phrases don't match.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const FORBIDDEN = [/pretend/i, /\bthis demo\b/i, /\bin the demo\b/i, /placeholder rules/i, /nothing is charged/i];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The file without its comments: block comments (JSX ones too) and whole-line // comments. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the words people read (decision 139)', () => {
  const root = join(__dirname, '..');
  const files = [...sources(join(root, 'app')), ...sources(join(root, 'components'))];

  it('finds the screens and components', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('never call the money pretend or the app a demo', () => {
    const hits = files.flatMap((file) => {
      const text = withoutComments(readFileSync(file, 'utf8'));
      return FORBIDDEN.filter((re) => re.test(text)).map((re) => `${file.slice(root.length + 1)}: ${re}`);
    });
    expect(hits).toEqual([]);
  });
});
