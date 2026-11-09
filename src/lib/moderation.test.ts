// Unit tests for moderation.ts (T53): the word filter matches the database's exactly, whole words
// only; report reasons match the reports table; refusals read as plain sentences.
import { readFileSync } from 'fs';
import { join } from 'path';

import { isObjectionable, moderationErrorMessage, OBJECTIONABLE_WORDS, REPORT_REASONS } from './moderation';

const migration = readFileSync(join(__dirname, '../../supabase/migrations/0035_reports_and_blocks.sql'), 'utf8');

describe('the app mirrors migration 0035', () => {
  it('has the same word list as objectionable()', () => {
    const list = migration.match(/regexp_split_to_array\(lower\(t\), '\[\^a-z\]\+'\) && array\[([\s\S]*?)\]::text\[\]/)![1];
    const sqlWords = [...list.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect([...OBJECTIONABLE_WORDS].sort()).toEqual(sqlWords.sort());
  });

  it('has the same report reasons as the reports table', () => {
    const reasons = migration.match(/reason\s+text not null check \(reason in \(([^)]*)\)\)/)![1];
    expect(REPORT_REASONS.map((r) => r.value)).toEqual([...reasons.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  });
});

describe('isObjectionable (whole words, any case, any separator)', () => {
  it('catches a listed word in a username or a note', () => {
    expect(isObjectionable('shit.happens')).toBe(true);
    expect(isObjectionable('What a BITCH')).toBe(true);
    expect(isObjectionable('fuck_you')).toBe(true);
  });

  it('lets through words that only contain one (the Scunthorpe problem)', () => {
    expect(isObjectionable('scunthorpe_fan')).toBe(false);
    expect(isObjectionable('shitake')).toBe(false);
    expect(isObjectionable('mr.kangs')).toBe(false);
  });

  it('passes empty and missing text', () => {
    expect(isObjectionable('')).toBe(false);
    expect(isObjectionable(null)).toBe(false);
  });
});

describe('moderationErrorMessage', () => {
  it('turns the database’s refusals into plain sentences', () => {
    expect(moderationErrorMessage({ code: 'P0001', message: 'report_self' })).toBe('You can’t report yourself.');
    expect(moderationErrorMessage({ code: '23514', message: 'report_rate_limited' })).toMatch(/a lot of reports/);
    expect(moderationErrorMessage({ code: '23514', message: 'text_objectionable' })).toBe('Please choose different words. That one isn’t allowed on Kept.');
    expect(moderationErrorMessage({})).toBe('Couldn’t reach Kept. Check your connection and try again.');
    expect(moderationErrorMessage({ code: 'XX000', message: 'boom' })).toBe('Kept couldn’t do that. Please try again.');
  });
});
