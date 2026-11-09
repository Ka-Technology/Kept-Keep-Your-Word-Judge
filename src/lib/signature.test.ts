// Unit tests for signature.ts: a drawn signature as one SVG path in the fixed box the database checks (T203).
import { readFileSync } from 'fs';
import { join } from 'path';

import { SIGNATURE_PATH_MAX, signaturePath } from './signature';

describe('signaturePath (a drawn signature, in the 300 × 100 box it is stored in)', () => {
  it('scales a stroke from the pad’s size into the box', () => {
    const stroke = [
      { x: 0, y: 0 },
      { x: 300, y: 100 },
      { x: 600, y: 200 },
    ];
    expect(signaturePath([stroke], 600, 200)).toBe('M0 0L150 50L300 100');
  });

  it('draws a tap as a dot: a line that starts and ends on the same point', () => {
    expect(signaturePath([[{ x: 150, y: 50 }]], 300, 100)).toBe('M150 50L150 50');
  });

  it('starts each stroke with its own M', () => {
    const strokes = [
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      [
        { x: 5, y: 5 },
        { x: 6, y: 6 },
      ],
    ];
    expect(signaturePath(strokes, 300, 100)).toBe('M0 0L1 1M5 5L6 6');
  });

  it('keeps a finger that slid off the pad on its edge', () => {
    expect(signaturePath([[{ x: -10, y: 250 }, { x: 400, y: -3 }]], 300, 100)).toBe('M0 100L300 0');
  });

  it('rounds to a tenth', () => {
    expect(signaturePath([[{ x: 1 / 3, y: 2 / 3 }]], 300, 100)).toBe('M0.3 0.7L0.3 0.7');
  });

  it('is empty until something is drawn', () => {
    expect(signaturePath([], 300, 100)).toBe('');
    expect(signaturePath([[]], 300, 100)).toBe('');
  });

  it('matches the database’s check on challenge_signatures.strokes (migration 0082)', () => {
    const sql = readFileSync(join(__dirname, '../../supabase/migrations/0082_signatures.sql'), 'utf8');
    expect(sql).toContain(`char_length(strokes) <= ${SIGNATURE_PATH_MAX}`);
    const pattern = sql.match(/strokes ~ '([^']+)'/)?.[1];
    expect(pattern).toBeDefined();
    const re = new RegExp(pattern!);
    expect(re.test(signaturePath([[{ x: 1 / 3, y: 2 / 3 }, { x: 299.96, y: 100 }], [{ x: 5, y: 5 }]], 300, 100))).toBe(true);
    expect(re.test('<script>')).toBe(false);
    expect(re.test('M1 1 Z')).toBe(false);
  });
});
