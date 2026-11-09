// The third-party notices (T179): what Settings → About → Open-source licenses lists, from licenses.json, which
// scripts/licenses.mjs writes from the dependency tree. MIT, BSD and Apache ask for them to ship with the app.

import data from './licenses.json';

export type Licensed = { name: string; version: string; license: string; copyright: string; text: string };

const { texts, packages } = data as { texts: string[]; packages: [string, string, string, string, number][] };

/** Every package, by name. */
export const LICENSED: Licensed[] = packages.map(([name, version, license, copyright, i]) => ({
  name,
  version,
  license,
  copyright,
  text: i >= 0 ? texts[i] : '',
}));

/** A package's notice: its copyright lines, then its license text (or where to find it, if it ships none). */
export function noticeText(p: Licensed): string {
  const text = p.text || `Licensed under ${p.license}. The package ships no license file.`;
  return p.copyright ? `${p.copyright}\n\n${text}` : text;
}
