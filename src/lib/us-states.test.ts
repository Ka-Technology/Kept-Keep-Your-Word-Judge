/// <reference types="node" />
// Checks that the app's state list and the database's allowed state codes are the same list.
import { readFileSync } from 'fs';
import { join } from 'path';

import { US_STATES } from './us-states';

it('matches the state_code list allowed by the profiles migration', () => {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/0001_profiles.sql'), 'utf8');
  const list = sql.match(/state_code\s+text\s+not null\s+check\s*\(\s*state_code\s+in\s*\(([^)]*)\)/i);
  expect(list).not.toBeNull();

  const dbCodes = [...list![1].matchAll(/'([A-Z]{2})'/g)].map((m) => m[1]).sort();
  const appCodes = US_STATES.map((s) => s.code).sort();
  expect(dbCodes).toEqual(appCodes);
});
