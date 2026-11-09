/// <reference types="node" />
// Unit tests for profile.ts: the username and 18+ rules, including the Feb 29 edge cases the DB also handles.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  ADULT_MESSAGE,
  AGREEMENT_MISSING_MESSAGE,
  AI_CHOICE_MISSING_MESSAGE,
  DOB_MISSING_MESSAGE,
  FIRST_NAME_MISSING_MESSAGE,
  fromDateString,
  fullName,
  isAdult,
  LAST_NAME_MISSING_MESSAGE,
  NAME_MAX,
  NAME_TOO_LONG_MESSAGE,
  nameError,
  profileErrors,
  profileSaveMessage,
  profileSaveResult,
  profileUpdateResult,
  STATE_MISSING_MESSAGE,
  toDateString,
  USERNAME_RE,
  USERNAME_RULE_MESSAGE,
  USERNAME_TAKEN_MESSAGE,
} from './profile';
import { OBJECTIONABLE_MESSAGE } from './moderation';
import { clearProfileDraft, peekProfileDraft, saveProfileDraft } from './profile-draft';
import { US_STATES } from './us-states';

describe('profileErrors', () => {
  const today = new Date(2026, 8, 24);
  const valid = { firstName: 'Sam', lastName: 'Lee', username: 'kept_user', dob: new Date(1990, 0, 1), stateCode: 'NY', aiAllowed: true, agreed: true };

  it('finds nothing wrong with complete, valid details', () => {
    expect(profileErrors(valid, today)).toEqual({});
  });

  it('explains the username rule', () => {
    expect(profileErrors({ ...valid, username: 'Bad Name' }, today)).toEqual({ username: USERNAME_RULE_MESSAGE });
  });

  it('refuses a username with a word on Kept’s list, as the database does (T53)', () => {
    expect(profileErrors({ ...valid, username: 'shit.happens' }, today)).toEqual({ username: OBJECTIONABLE_MESSAGE });
    expect(profileErrors({ ...valid, username: 'scunthorpe_fan' }, today)).toEqual({});
  });

  it('explains the database’s word-filter refusal after a save', () => {
    const result = profileSaveResult({ code: '23514', message: 'text_objectionable' });
    expect(result).toBe('username-objectionable');
    expect(profileSaveMessage(result as 'username-objectionable')).toBe(OBJECTIONABLE_MESSAGE);
  });

  it('asks for a missing date of birth', () => {
    expect(profileErrors({ ...valid, dob: null }, today)).toEqual({ dob: DOB_MISSING_MESSAGE });
  });

  it('turns away anyone under 18', () => {
    expect(profileErrors({ ...valid, dob: new Date(2008, 8, 25) }, today)).toEqual({ dob: ADULT_MESSAGE });
    expect(ADULT_MESSAGE).toBe('Kept is for adults 18 and over.');
  });

  it('accepts someone turning 18 today', () => {
    expect(profileErrors({ ...valid, dob: new Date(2008, 8, 24) }, today)).toEqual({});
  });

  it('asks for a missing state', () => {
    expect(profileErrors({ ...valid, stateCode: null }, today)).toEqual({ state: STATE_MISSING_MESSAGE });
  });

  it('rejects a state code outside the list', () => {
    expect(profileErrors({ ...valid, stateCode: 'XX' }, today)).toEqual({ state: STATE_MISSING_MESSAGE });
  });

  it('asks Allow or Don’t allow for Kept’s AI, with neither preselected (decision 96)', () => {
    expect(profileErrors({ ...valid, aiAllowed: null }, today)).toEqual({ ai: AI_CHOICE_MISSING_MESSAGE });
    expect(profileErrors({ ...valid, aiAllowed: false }, today)).toEqual({});
  });

  it('asks for a first and a last name (decision 100), ignoring spaces around them', () => {
    expect(profileErrors({ ...valid, firstName: '  ' }, today)).toEqual({ firstName: FIRST_NAME_MISSING_MESSAGE });
    expect(profileErrors({ ...valid, lastName: '' }, today)).toEqual({ lastName: LAST_NAME_MISSING_MESSAGE });
    expect(profileErrors({ ...valid, firstName: ' Mary Ann ', lastName: 'O’Neil-Smith' }, today)).toEqual({});
  });

  it('allows names up to 50 characters, as the database does', () => {
    expect(profileErrors({ ...valid, lastName: 'x'.repeat(NAME_MAX) }, today)).toEqual({});
    expect(profileErrors({ ...valid, lastName: 'x'.repeat(NAME_MAX + 1) }, today)).toEqual({ lastName: NAME_TOO_LONG_MESSAGE });
    expect(NAME_TOO_LONG_MESSAGE).toBe('Use 50 characters or fewer.');
  });

  it('asks for the 18+ tick box, left unticked to start (decision 99)', () => {
    expect(profileErrors({ ...valid, agreed: false }, today)).toEqual({ agreed: AGREEMENT_MISSING_MESSAGE });
    expect(AGREEMENT_MISSING_MESSAGE).toBe('Tick the box to confirm you’re 18 or older and agree to the Terms and the Privacy Policy.');
  });

  it('reports every problem at once', () => {
    expect(Object.keys(profileErrors({ firstName: '', lastName: '', username: '', dob: null, stateCode: null, aiAllowed: null, agreed: false }, today)).sort()).toEqual([
      'agreed',
      'ai',
      'dob',
      'firstName',
      'lastName',
      'state',
      'username',
    ]);
  });
});

describe('nameError (Personal info, T145)', () => {
  it('checks one name the way the sign-up form does', () => {
    expect(nameError('Sam', 'first')).toBeUndefined();
    expect(nameError(' ', 'first')).toBe(FIRST_NAME_MISSING_MESSAGE);
    expect(nameError('', 'last')).toBe(LAST_NAME_MISSING_MESSAGE);
    expect(nameError('x'.repeat(51), 'last')).toBe(NAME_TOO_LONG_MESSAGE);
  });

  it('matches migration 0050’s rule: trimmed, 1 to NAME_MAX characters', () => {
    const sql = readFileSync(join(__dirname, '../../supabase/migrations/0050_real_names.sql'), 'utf8');
    expect(sql).toContain(`char_length(first_name) between 1 and ${NAME_MAX}`);
    expect(sql).toContain(`char_length(last_name) between 1 and ${NAME_MAX}`);
  });
});

describe('fullName (the name a challenge is signed with, T203)', () => {
  it('joins the first and last name', () => {
    expect(fullName({ first_name: 'Kenneth', last_name: 'Kang' })).toBe('Kenneth Kang');
  });

  it('is null until both are on file (accounts from before decision 100)', () => {
    expect(fullName({ first_name: 'Kenneth', last_name: null })).toBeNull();
    expect(fullName({ first_name: null, last_name: null })).toBeNull();
  });
});

describe('toDateString', () => {
  it('uses the local calendar date, even late at night (toISOString would shift to UTC)', () => {
    expect(toDateString(new Date(2000, 0, 5, 23, 59))).toBe('2000-01-05');
  });

  it('pads months and days', () => {
    expect(toDateString(new Date(1999, 11, 31))).toBe('1999-12-31');
    expect(toDateString(new Date(2001, 2, 4))).toBe('2001-03-04');
  });
});

describe('fromDateString', () => {
  it("reads a stored date as that calendar day in the phone's time zone, not UTC", () => {
    const date = fromDateString('2000-01-05');
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2000, 0, 5]);
  });

  it('undoes toDateString, including at the year boundary', () => {
    for (const day of ['1999-12-31', '2000-01-01', '2004-02-29']) {
      expect(toDateString(fromDateString(day))).toBe(day);
    }
  });
});

describe('profileSaveResult', () => {
  it('is saved when there is no error', () => {
    expect(profileSaveResult(null)).toBe('saved');
  });

  it('recognizes a username someone else has', () => {
    const error = { code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' };
    expect(profileSaveResult(error)).toBe('username-taken');
  });

  it("counts the user's own existing row as saved (an earlier save whose answer was lost)", () => {
    const error = { code: '23505', message: 'duplicate key value violates unique constraint "profiles_pkey"' };
    expect(profileSaveResult(error)).toBe('saved');
  });

  it("recognizes a username the database's rule rejects", () => {
    const error = { code: '23514', message: 'new row for relation "profiles" violates check constraint "profiles_username_check"' };
    expect(profileSaveResult(error)).toBe('username-invalid');
  });

  it('calls any other database refusal rejected, not a connection problem', () => {
    const error = { code: '42501', message: 'new row violates row-level security policy for table "profiles"' };
    expect(profileSaveResult(error)).toBe('rejected');
  });

  it('calls a request that never got an answer offline', () => {
    expect(profileSaveResult({ code: '', message: 'TypeError: Network request failed' })).toBe('offline');
  });
});

describe('profileUpdateResult', () => {
  const row = { id: 'user-a', username: 'alice', date_of_birth: '1990-01-01', state_code: 'NY' };

  it('is saved when the updated row comes back', () => {
    expect(profileUpdateResult(null, row)).toBe('saved');
  });

  it('is rejected when nothing was updated, which is how row-level security refuses an update', () => {
    expect(profileUpdateResult(null, null)).toBe('rejected');
  });

  it('spots a taken or invalid username the same way as saving a new profile', () => {
    expect(profileUpdateResult({ code: '23505', message: 'violates unique constraint "profiles_username_key"' }, null)).toBe(
      'username-taken',
    );
    expect(profileUpdateResult({ code: '23514', message: 'violates check constraint "profiles_username_check"' }, null)).toBe(
      'username-invalid',
    );
  });

  it('is offline when there was no answer, and rejected for any other database error', () => {
    expect(profileUpdateResult({ message: 'Network request failed' }, null)).toBe('offline');
    expect(profileUpdateResult({ code: '42501', message: 'permission denied' }, null)).toBe('rejected');
  });
});

describe('profileSaveMessage', () => {
  it.each([
    ['username-taken', USERNAME_TAKEN_MESSAGE],
    ['username-invalid', USERNAME_RULE_MESSAGE],
    ['offline', "Couldn't save your profile. Check your connection and try again."],
    ['rejected', "Kept couldn't save your profile. Please try again."],
  ] as const)('explains %s in a plain sentence', (result, message) => {
    expect(profileSaveMessage(result)).toBe(message);
  });
});

describe('profile draft', () => {
  const details = { firstName: 'Sam', lastName: 'Lee', username: 'kept_user', dob: new Date(1990, 0, 1), stateCode: 'NY', aiAllowed: false };

  afterEach(clearProfileDraft);

  it('hands the details to the account they were typed for, until they are saved', () => {
    saveProfileDraft('New@Example.com ', details);
    // A render React throws away and starts again must find them too.
    expect(peekProfileDraft('new@example.com')).toEqual(details);
    expect(peekProfileDraft('new@example.com')).toEqual(details);
    clearProfileDraft();
    expect(peekProfileDraft('new@example.com')).toBeNull();
  });

  it('never hands them to a different account', () => {
    saveProfileDraft('a@example.com', details);
    expect(peekProfileDraft('b@example.com')).toBeNull();
    expect(peekProfileDraft(undefined)).toBeNull();
    expect(peekProfileDraft('a@example.com')).toEqual(details);
  });

  it('keeps only the latest sign-up', () => {
    saveProfileDraft('a@example.com', details);
    saveProfileDraft('b@example.com', { ...details, username: 'other' });
    expect(peekProfileDraft('a@example.com')).toBeNull();
    expect(peekProfileDraft('b@example.com')?.username).toBe('other');
  });
});

describe('USERNAME_RE', () => {
  it.each(['abc', 'kept_user_1', 'dash-name', 'dot.name', 'kept.user_2-x', 'a'.repeat(30), '___', '123'])(
    'accepts %p',
    (name) => {
      expect(USERNAME_RE.test(name)).toBe(true);
    },
  );

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(31)],
    ['empty', ''],
    ['uppercase', 'Alice'],
    ['space', 'has space'],
    ['@', 'me@kept'],
    ['!', 'kept!'],
    ['non-ASCII letter', 'josé'],
    ['trailing newline', 'abc\n'],
  ])('rejects %s (%p)', (_label, name) => {
    expect(USERNAME_RE.test(name)).toBe(false);
  });

  it('explains the rule in words', () => {
    expect(USERNAME_RULE_MESSAGE).toBe('Use 3–30 lowercase letters, numbers, periods, underscores or hyphens.');
  });

  it('matches the username check in the latest migration that sets it', () => {
    const dir = join(__dirname, '../../supabase/migrations');
    const sql = readdirSync(dir)
      .sort()
      .map((file) => readFileSync(join(dir, file), 'utf8'))
      .join('\n');
    const rules = [...sql.matchAll(/username\s*~\s*'([^']+)'/g)].map((m) => m[1]);
    expect(rules.at(-1)).toBe(USERNAME_RE.source);
  });
});

describe('isAdult', () => {
  const sep23_2026 = new Date(2026, 8, 23);

  it('is true on the 18th birthday', () => {
    expect(isAdult(new Date(2008, 8, 23), sep23_2026)).toBe(true);
  });

  it('is false the day before the 18th birthday', () => {
    expect(isAdult(new Date(2008, 8, 24), sep23_2026)).toBe(false);
  });

  it('is true the day after the 18th birthday', () => {
    expect(isAdult(new Date(2008, 8, 22), sep23_2026)).toBe(true);
  });

  it('ignores the time of day on the birth date', () => {
    const bornInTheEvening = new Date(2008, 8, 23, 18, 30);
    const checkedInTheMorning = new Date(2026, 8, 23, 9, 0);
    expect(isAdult(bornInTheEvening, checkedInTheMorning)).toBe(true);
  });

  it('treats a Feb 29 birth as turning 18 on Mar 1 in a non-leap year', () => {
    const bornLeapDay = new Date(2008, 1, 29);
    expect(isAdult(bornLeapDay, new Date(2026, 1, 28))).toBe(false);
    expect(isAdult(bornLeapDay, new Date(2026, 2, 1))).toBe(true);
  });

  it('matches Postgres on Feb 29: someone born Mar 1 is not yet 18', () => {
    const feb29_2028 = new Date(2028, 1, 29);
    expect(isAdult(new Date(2010, 2, 1), feb29_2028)).toBe(false);
    expect(isAdult(new Date(2010, 1, 28), feb29_2028)).toBe(true);
  });

  it('is false for a birth date in the future', () => {
    expect(isAdult(new Date(2030, 0, 1), sep23_2026)).toBe(false);
  });
});

describe('US_STATES', () => {
  it('lists the 50 states plus DC', () => {
    expect(US_STATES).toHaveLength(51);
    expect(US_STATES.map((s) => s.code)).toContain('DC');
  });

  it('has unique two-letter uppercase codes', () => {
    const codes = US_STATES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it('is sorted by name for the picker', () => {
    const names = US_STATES.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
