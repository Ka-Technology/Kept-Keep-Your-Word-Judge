// Unit tests for secure-storage.ts: the session in the Keychain, in chunks, moved over from AsyncStorage.
import { CHUNK, chunkedStorage } from './secure-storage';

// The module also builds the real store on AsyncStorage; these tests use fakes instead.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/** A Keychain stand-in that, like the real one, refuses values past its limit. */
function fakeKeychain() {
  const items = new Map<string, string>();
  return {
    items,
    getItemAsync: async (k: string) => items.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => {
      if (v.length > CHUNK) throw new Error('value too large');
      items.set(k, v);
    },
    deleteItemAsync: async (k: string) => void items.delete(k),
  };
}

function fakeAsyncStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return { items, getItem: async (k: string) => items.get(k) ?? null, removeItem: async (k: string) => void items.delete(k) };
}

describe('chunkedStorage (the session in the Keychain; security, 2026-09-27)', () => {
  const session = JSON.stringify({ access_token: 'x'.repeat(4000), refresh_token: 'r' });

  it('stores a session larger than one Keychain item, and reads it back whole', async () => {
    const keychain = fakeKeychain();
    const storage = chunkedStorage(keychain);
    await storage.setItem('kept-auth', session);
    expect(keychain.items.get('kept-auth.n')).toBe('3');
    expect(await storage.getItem('kept-auth')).toBe(session);
  });

  it('removes leftover chunks when a shorter session replaces a longer one, and everything on sign-out', async () => {
    const keychain = fakeKeychain();
    const storage = chunkedStorage(keychain);
    await storage.setItem('kept-auth', session);
    await storage.setItem('kept-auth', 'short');
    expect([...keychain.items.keys()].sort()).toEqual(['kept-auth.0', 'kept-auth.n']);
    expect(await storage.getItem('kept-auth')).toBe('short');
    await storage.removeItem('kept-auth');
    expect(keychain.items.size).toBe(0);
    expect(await storage.getItem('kept-auth')).toBeNull();
  });

  it('moves a session an older build left in AsyncStorage into the Keychain, and deletes the file copy', async () => {
    const keychain = fakeKeychain();
    const old = fakeAsyncStorage({ 'kept-auth': session });
    const storage = chunkedStorage(keychain, old);
    expect(await storage.getItem('kept-auth')).toBe(session);
    expect(old.items.has('kept-auth')).toBe(false);
    expect(await chunkedStorage(keychain).getItem('kept-auth')).toBe(session);
  });

  it('reads nothing when a chunk is missing, rather than a broken session', async () => {
    const keychain = fakeKeychain();
    const storage = chunkedStorage(keychain);
    await storage.setItem('kept-auth', session);
    keychain.items.delete('kept-auth.1');
    expect(await storage.getItem('kept-auth')).toBeNull();
  });
});
