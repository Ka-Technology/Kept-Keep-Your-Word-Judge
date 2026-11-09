// Writes src/lib/licenses.json, the third-party notices Settings → About → Open-source licenses shows (T179):
// every package the app's dependencies pull in (package.json `dependencies`, followed through node_modules), with
// its version, license and copyright lines, and each distinct license text once (copyright lines taken out, so
// the many MIT texts collapse to a few). MIT, BSD and Apache ask for these notices to ship with the app.
//   node scripts/licenses.mjs     after `npx expo install` adds or upgrades a dependency
// src/lib/licenses.test.ts fails when a dependency is missing from the file or listed at another version.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** A package's package.json, found the way Node finds it from `from`. */
function find(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const file = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(file)) return file;
    if (dirname(dir) === dir) return null;
  }
}

const seen = new Map();
function walk(name, from) {
  const file = find(name, from);
  if (!file) return; // an optional dependency for another platform
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) return;
  const dir = dirname(file);
  const licenseFile = readdirSync(dir).find((f) => /^(licen[sc]e|copying)/i.test(f));
  const text = licenseFile ? readFileSync(join(dir, licenseFile), 'utf8').replace(/\r\n/g, '\n') : '';
  const copyright = text.split('\n').filter((l) => /^\s*(copyright|\(c\)|©)/i.test(l)).map((l) => l.trim());
  const body = text
    .split('\n')
    .filter((l) => !/^\s*(copyright|\(c\)|©)/i.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'See the package');
  seen.set(key, { name: pkg.name, version: pkg.version, license, copyright: copyright.join('\n'), body });
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) walk(dep, dir);
}

const root = JSON.parse(readFileSync('package.json', 'utf8'));
for (const dep of Object.keys(root.dependencies)) walk(dep, process.cwd());

const texts = [];
const packages = [...seen.values()]
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  .map((p) => {
    let i = p.body ? texts.indexOf(p.body) : -1;
    if (p.body && i < 0) i = texts.push(p.body) - 1;
    return [p.name, p.version, p.license, p.copyright, i];
  });
writeFileSync('src/lib/licenses.json', JSON.stringify({ texts, packages }) + '\n');
console.log(`${packages.length} packages, ${texts.length} license texts`);
