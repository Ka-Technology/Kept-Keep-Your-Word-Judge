// Unit tests for privacy-note.ts (T54): the choice before check-ins go to Kept's AI says who gets
// what and what Don't allow means, and Settings says where the user stands.
import { AI_CHOICE_MESSAGE, AI_CHOICE_TITLE, aiChoiceSummary, CHECK_IN_PRIVACY_NOTE } from './privacy-note';

describe('the choice before the first check-in (App Review 5.1.2(i))', () => {
  it('asks a question, rather than announcing', () => {
    expect(AI_CHOICE_TITLE).toBe('Let Kept’s AI check your days?');
  });

  it('names the AI provider, what goes to it, and that it never trains on it', () => {
    expect(AI_CHOICE_MESSAGE).toMatch(/Anthropic/);
    expect(AI_CHOICE_MESSAGE).toMatch(/photo and answers/);
    expect(AI_CHOICE_MESSAGE).toMatch(/never to train/);
  });

  it('says what Don’t allow costs (owner, 2026-09-30) and where to change it', () => {
    expect(AI_CHOICE_MESSAGE).toMatch(/a day no friend approves counts as missed/);
    expect(AI_CHOICE_MESSAGE).toMatch(/Settings/);
  });

  it('stays short enough for a phone alert (owner, 2026-10-01: the first one was too long)', () => {
    expect(AI_CHOICE_MESSAGE.split(/\s+/).length).toBeLessThanOrEqual(50);
  });

  it('leaves the 30-day photo deletion to Settings', () => {
    expect(CHECK_IN_PRIVACY_NOTE).toMatch(/30 days/);
  });
});

describe('aiChoiceSummary (Settings → Privacy & security)', () => {
  it('says where the user stands, including not asked yet', () => {
    expect(aiChoiceSummary(true)).toBe('Kept’s AI checks a day no friend has approved by 10 pm.');
    expect(aiChoiceSummary(false)).toBe('Only friends who back you check your days. A day none of them approves by midnight counts as missed.');
    expect(aiChoiceSummary(null)).toBe('You’ll be asked before your first check-in.');
  });
});
