// Unit tests for feedback.ts (T158): the kinds and the length limit match the feedback table, a
// message is checked the way the database checks it, and refusals read as plain sentences.
import { readFileSync } from 'fs';
import { join } from 'path';

import { FEEDBACK_KINDS, FEEDBACK_MAX, feedbackErrorMessage, feedbackPhotoPath, feedbackProblem } from './feedback';

const migration = readFileSync(join(__dirname, '../../supabase/migrations/0053_feedback.sql'), 'utf8');

describe('the app mirrors migration 0053', () => {
  it('has the same kinds as the feedback table', () => {
    const kinds = migration.match(/kind\s+text not null check \(kind in \(([^)]*)\)\)/)![1];
    expect(FEEDBACK_KINDS.map((k) => k.value)).toEqual([...kinds.matchAll(/'([a-z]+)'/g)].map((m) => m[1]));
  });

  it('has the same length limit as the feedback table', () => {
    const max = migration.match(/check \(char_length\(btrim\(message\)\) between 1 and (\d+)\)/)![1];
    expect(FEEDBACK_MAX).toBe(Number(max));
  });
});

describe('feedbackProblem (null when it can be sent)', () => {
  it('needs a kind', () => {
    expect(feedbackProblem(null, 'The app froze')).toBe('Pick what it’s about.');
  });

  it('needs a message that isn’t only spaces', () => {
    expect(feedbackProblem('bug', '')).toBe('Write a message first.');
    expect(feedbackProblem('bug', '   \n ')).toBe('Write a message first.');
  });

  it('counts the trimmed message against the limit, as the database does', () => {
    expect(feedbackProblem('idea', `  ${'a'.repeat(FEEDBACK_MAX)}  `)).toBeNull();
    expect(feedbackProblem('idea', 'a'.repeat(FEEDBACK_MAX + 1))).toBe(`Keep it under ${FEEDBACK_MAX} characters.`);
  });

  it('passes a short request', () => {
    expect(feedbackProblem('habit', 'Please add flossing')).toBeNull();
  });
});

describe('feedbackPhotoPath', () => {
  it('puts the photo in the sender’s own folder, as the bucket requires', () => {
    expect(feedbackPhotoPath('user-1', 'abc')).toBe('user-1/abc.jpg');
  });
});

describe('feedbackErrorMessage', () => {
  it('turns the database’s refusals into plain sentences', () => {
    expect(feedbackErrorMessage({ code: '23514', message: 'feedback_rate_limited' })).toMatch(/a lot of feedback/);
    expect(feedbackErrorMessage({})).toBe('Couldn’t reach Kept. Check your connection and try again.');
    expect(feedbackErrorMessage({ code: 'XX000', message: 'boom' })).toBe('Kept couldn’t send that. Please try again.');
  });
});
