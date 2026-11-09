// Unit tests for shield-warnings.ts (T35, SPEC-notifications.md section 5): which days get a warning,
// at what moment, and what it says.
import { shieldWarnings, type WarningChallenge } from './shield-warnings';

const walk: WarningChallenge = {
  id: 'w',
  title: 'Walk or run',
  timeZone: 'America/Los_Angeles',
  today: 5,
  daysRequired: 28,
  shieldsLeft: 2,
  state: 'active',
  checkedInToday: false,
};
// 3 pm in Los Angeles on Tuesday, September 29, 2026 (UTC−7).
const afternoon = new Date('2026-09-29T22:00:00Z');

describe('shieldWarnings', () => {
  it('warns at 8 pm in the challenge’s zone, today and the next 6 days', () => {
    const warnings = shieldWarnings([walk], afternoon);
    expect(warnings.map((w) => w.at.toISOString())).toEqual([
      '2026-09-30T03:00:00.000Z',
      '2026-10-01T03:00:00.000Z',
      '2026-10-02T03:00:00.000Z',
      '2026-10-03T03:00:00.000Z',
      '2026-10-04T03:00:00.000Z',
      '2026-10-05T03:00:00.000Z',
      '2026-10-06T03:00:00.000Z',
    ]);
    expect(warnings[0]).toMatchObject({
      title: 'Check in before midnight',
      body: 'You haven’t checked in for Walk or run today. Miss it and you lose a shield.',
      url: '/check-in',
    });
  });

  it('skips today once checked in, and today once 8 pm has passed', () => {
    expect(shieldWarnings([{ ...walk, checkedInToday: true }], afternoon)[0].at.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    const evening = new Date('2026-09-30T03:30:00Z'); // 8:30 pm in Los Angeles
    expect(shieldWarnings([walk], evening)[0].at.toISOString()).toBe('2026-10-01T03:00:00.000Z');
  });

  it('says the challenge ends only when no shield is left (two shields: a miss on the last one runs on)', () => {
    expect(shieldWarnings([{ ...walk, shieldsLeft: 1 }], afternoon)[0].body).toBe(
      'You haven’t checked in for Walk or run today. Miss it and you lose your last shield.',
    );
    expect(shieldWarnings([{ ...walk, shieldsLeft: 0 }], afternoon)[0].body).toBe(
      'You haven’t checked in for Walk or run today. Miss it and the challenge ends.',
    );
  });

  it('makes one notification for challenges due at the same moment', () => {
    const warnings = shieldWarnings([walk, { ...walk, id: 'r', title: 'Read' }, { ...walk, id: 's', title: 'Study' }], afternoon);
    expect(warnings).toHaveLength(7);
    expect(warnings[0].body).toBe('You haven’t checked in for Walk or run, Read and Study today. Miss them and you lose shields.');
  });

  it('keeps challenges in different zones apart', () => {
    const seoul = { ...walk, id: 'k', title: 'Read', timeZone: 'Asia/Seoul' };
    const warnings = shieldWarnings([walk, seoul], afternoon);
    // 3 pm in Los Angeles is 7 am the next day in Seoul, whose 8 pm is 11:00 UTC.
    expect(warnings[0].at.toISOString()).toBe('2026-09-30T03:00:00.000Z');
    expect(warnings[1].at.toISOString()).toBe('2026-09-30T11:00:00.000Z');
    expect(warnings).toHaveLength(14);
  });

  it('stops at the last day the challenge can still need, and skips ended ones', () => {
    expect(shieldWarnings([{ ...walk, today: 27 }], afternoon)).toHaveLength(2);
    expect(shieldWarnings([{ ...walk, state: 'finished' }], afternoon)).toEqual([]);
  });

  it('starts on Day 1 for a challenge that starts tomorrow', () => {
    const warnings = shieldWarnings([{ ...walk, today: 0, state: 'upcoming' }], afternoon);
    expect(warnings[0].at.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(warnings).toHaveLength(6);
  });

  it('follows a daylight-saving change: 8 pm stays 8 pm', () => {
    // Clocks go back in Los Angeles on Sunday, November 1, 2026: 8 pm is then 04:00 UTC.
    const saturday = new Date('2026-10-31T22:00:00Z');
    const [sat, sun] = shieldWarnings([walk], saturday);
    expect(sat.at.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(sun.at.toISOString()).toBe('2026-11-02T04:00:00.000Z');
  });
});
