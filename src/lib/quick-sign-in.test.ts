// Unit tests for quick-sign-in.ts (T38): saving the sign-in behind Face ID, reading it back, and
// what happens when the scan is cancelled, biometrics changed, or the password no longer works.
import { biometricName, canQuickSignIn, quickSignIn } from './quick-sign-in';

/** A Keychain stand-in. `scan` sets what a read of the locked store does, like the phone's Face ID would. */
function fakeKeychains() {
  const plain = new Map<string, string>();
  const locked = new Map<string, string>();
  const fake = {
    plain,
    locked,
    scan: 'ok' as 'ok' | 'cancel',
    plainStore: {
      getItemAsync: async (k: string) => plain.get(k) ?? null,
      setItemAsync: async (k: string, v: string) => void plain.set(k, v),
      deleteItemAsync: async (k: string) => void plain.delete(k),
    },
    lockedStore: {
      getItemAsync: async (k: string) => {
        if (fake.scan === 'cancel') throw new Error('User canceled the operation.');
        return locked.get(k) ?? null;
      },
      setItemAsync: async (k: string, v: string) => {
        // The real Keychain asks for a scan to overwrite an item; a fresh one needs none.
        if (locked.has(k)) throw new Error('overwrite needs a scan');
        locked.set(k, v);
      },
      deleteItemAsync: async (k: string) => void locked.delete(k),
    },
  };
  return fake;
}

const creds = { email: 'ana@example.com', password: 'correct horse' };

describe('quickSignIn (T38)', () => {
  it('starts with no choice, so the first password sign-in asks', async () => {
    const k = fakeKeychains();
    expect(await quickSignIn(k.plainStore, k.lockedStore).choice()).toBeNull();
  });

  it('turning it on saves the sign-in behind biometrics, without a scan, even over an old one', async () => {
    const k = fakeKeychains();
    const qs = quickSignIn(k.plainStore, k.lockedStore);
    await qs.turnOn({ email: 'old@example.com', password: 'old' });
    await qs.turnOn(creds);
    expect(await qs.choice()).toBe('on');
    expect(k.plain.size).toBe(1);
    expect(JSON.stringify([...k.plain.values()])).not.toContain('correct horse');
  });

  it('one scan signs in with the saved email and password', async () => {
    const k = fakeKeychains();
    const qs = quickSignIn(k.plainStore, k.lockedStore);
    await qs.turnOn(creds);
    const sent: unknown[] = [];
    const result = await qs.signIn(async (c) => {
      sent.push(c);
      return { error: null };
    });
    expect(result).toEqual({ kind: 'signed-in' });
    expect(sent).toEqual([creds]);
  });

  it('a cancelled scan keeps the saved sign-in and signs nothing in', async () => {
    const k = fakeKeychains();
    const qs = quickSignIn(k.plainStore, k.lockedStore);
    await qs.turnOn(creds);
    k.scan = 'cancel';
    const result = await qs.signIn(async () => {
      throw new Error('should not sign in');
    });
    expect(result).toEqual({ kind: 'cancelled' });
    expect(await qs.choice()).toBe('on');
    expect(k.locked.size).toBe(1);
  });

  it('a saved password that no longer works is deleted, and the next password sign-in asks again', async () => {
    const k = fakeKeychains();
    const qs = quickSignIn(k.plainStore, k.lockedStore);
    await qs.turnOn(creds);
    const result = await qs.signIn(async () => ({ error: { code: 'invalid_credentials' } }));
    expect(result).toEqual({ kind: 'forgotten', email: creds.email });
    expect(k.locked.size).toBe(0);
    expect(await qs.choice()).toBeNull();
  });

  it('when biometrics changed (the Keychain item is gone), it forgets the sign-in', async () => {
    const k = fakeKeychains();
    const qs = quickSignIn(k.plainStore, k.lockedStore);
    await qs.turnOn(creds);
    k.locked.clear();
    const result = await qs.signIn(async () => {
      throw new Error('should not sign in');
    });
    expect(result).toEqual({ kind: 'forgotten', email: null });
    expect(await qs.choice()).toBeNull();
  });

  it('a network failure keeps the saved sign-in and passes the error on', async () => {
    const k = fakeKeychains();
    const qs = quickSignIn(k.plainStore, k.lockedStore);
    await qs.turnOn(creds);
    const error = { name: 'AuthRetryableFetchError' };
    expect(await qs.signIn(async () => ({ error }))).toEqual({ kind: 'error', error });
    expect(k.locked.size).toBe(1);
  });

  it('turning it off deletes the saved sign-in and remembers not to ask again', async () => {
    const k = fakeKeychains();
    const qs = quickSignIn(k.plainStore, k.lockedStore);
    await qs.turnOn(creds);
    await qs.turnOff();
    expect(k.locked.size).toBe(0);
    expect(await qs.choice()).toBe('off');
  });

  it('forget (account deleted) removes everything, so the next account on the phone is asked', async () => {
    const k = fakeKeychains();
    const qs = quickSignIn(k.plainStore, k.lockedStore);
    await qs.turnOn(creds);
    await qs.forget();
    expect(k.locked.size + k.plain.size).toBe(0);
  });
});

describe('biometricName', () => {
  it('names what the phone has', () => {
    expect(biometricName([2], 'ios')).toBe('Face ID');
    expect(biometricName([1], 'ios')).toBe('Touch ID');
    expect(biometricName([1], 'android')).toBe('fingerprint');
    expect(biometricName([], 'ios')).toBeNull();
  });
});

describe('canQuickSignIn (email accounts only, SPEC-identity.md)', () => {
  it('is for accounts with a password, never for Apple or Google, which have none to save', () => {
    expect(canQuickSignIn('email')).toBe(true);
    expect(canQuickSignIn('apple')).toBe(false);
    expect(canQuickSignIn('google')).toBe(false);
    expect(canQuickSignIn(undefined)).toBe(false);
  });
});
