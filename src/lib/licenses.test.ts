// The open-source notices (T179) stay in step with the dependencies: regenerate with `node scripts/licenses.mjs`.
import { readFileSync } from 'node:fs';

import { LICENSED, noticeText } from './licenses';

describe('the open-source licenses list', () => {
  it('lists every dependency at the version installed', () => {
    const deps = Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).dependencies);
    for (const name of deps) {
      const installed = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version;
      expect(LICENSED.some((p) => p.name === name && p.version === installed)).toBe(true);
    }
  });

  it('shows each package’s copyright with its license text', () => {
    const react = LICENSED.find((p) => p.name === 'react')!;
    expect(react.license).toBe('MIT');
    expect(noticeText(react)).toMatch(/^Copyright \(c\) Meta Platforms, Inc\. and affiliates\.\n\nMIT License/);
  });
});
