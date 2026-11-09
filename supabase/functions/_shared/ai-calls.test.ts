// Unit tests for ai-calls.ts: the ceiling's three database calls (plan.md decision 180, T244), with a fake client.
import { firstOverLimitDay, releaseCall, takeCall } from './ai-calls';

/** A client whose rpc answers from `answers` by function name, and remembers what it was asked. */
function fakeAdmin(answers: Record<string, { data?: unknown; error?: unknown }>) {
  const calls: { name: string; args: unknown }[] = [];
  return {
    calls,
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: null, error: null, ...answers[name] };
    },
  } as never;
}

describe('takeCall', () => {
  it('asks the database for one call of a kind and returns its id', async () => {
    const admin = fakeAdmin({ ai_take: { data: 41 } });
    await expect(takeCall(admin, 'user-1', 'photo')).resolves.toBe(41);
    expect((admin as unknown as { calls: unknown[] }).calls).toEqual([{ name: 'ai_take', args: { uid: 'user-1', what: 'photo' } }]);
  });

  it('returns null when the user has used their allowance', async () => {
    await expect(takeCall(fakeAdmin({ ai_take: { data: null } }), 'user-1', 'quiz_write')).resolves.toBeNull();
  });

  it('throws on a database error, so the caller counts it as Kept’s failure and never as a free pass', async () => {
    await expect(takeCall(fakeAdmin({ ai_take: { error: new Error('db down') } }), 'user-1', 'photo')).rejects.toThrow('db down');
  });
});

describe('releaseCall', () => {
  it('gives a call back', async () => {
    const admin = fakeAdmin({});
    await releaseCall(admin, 41);
    expect((admin as unknown as { calls: unknown[] }).calls).toEqual([{ name: 'ai_release', args: { call: 41 } }]);
  });

  it('never throws: a call that stays counted is a small cost, not a reason to fail the day', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(releaseCall(fakeAdmin({ ai_release: { error: new Error('db down') } }), 41)).resolves.toBeUndefined();
    quiet.mockRestore();
  });
});

describe('firstOverLimitDay', () => {
  it('asks the database whether this day of the challenge is the one that passes', async () => {
    const admin = fakeAdmin({ ai_limit_day: { data: true } });
    await expect(firstOverLimitDay(admin, 'ch1', 3)).resolves.toBe(true);
    expect((admin as unknown as { calls: unknown[] }).calls).toEqual([{ name: 'ai_limit_day', args: { challenge: 'ch1', on_day: 3 } }]);
    await expect(firstOverLimitDay(fakeAdmin({ ai_limit_day: { data: false } }), 'ch1', 4)).resolves.toBe(false);
  });

  it('throws on a database error', async () => {
    await expect(firstOverLimitDay(fakeAdmin({ ai_limit_day: { error: new Error('db down') } }), 'ch1', 3)).rejects.toThrow('db down');
  });
});
