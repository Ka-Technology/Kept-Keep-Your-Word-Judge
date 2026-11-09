// Unit tests for notifications.ts (T34, SPEC-notifications.md): the permission states Settings shows,
// and which screens a tapped notification may open.
import { permissionState, tapUrl } from './notifications';

// The pure parts under test never reach the database.
jest.mock('./supabase', () => ({ supabase: {} }));
// Since SDK 58, expo-notifications subscribes a default handler as it loads, and jest-expo's native mock
// gives that subscription no remove(), which setting Kept's handler calls.
jest.mock('expo-notifications', () => ({ ...jest.requireActual('expo-notifications'), setNotificationHandler: jest.fn() }));
// notifications.ts keeps the shield-warning switch on the phone (T35).
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('permissionState', () => {
  it('is on when allowed, including iOS’s quiet (provisional) permission', () => {
    expect(permissionState({ granted: true, canAskAgain: true })).toBe('on');
    expect(permissionState({ granted: false, canAskAgain: true, ios: { status: 3 } })).toBe('on');
  });

  it('can still be asked when iOS hasn’t asked yet, and is off once the person said no', () => {
    expect(permissionState({ granted: false, canAskAgain: true })).toBe('not-asked');
    expect(permissionState({ granted: false, canAskAgain: false })).toBe('off');
  });
});

describe('tapUrl (which screen a tapped notification opens)', () => {
  it('opens Kept’s own screens', () => {
    expect(tapUrl({ url: '/review/c1' })).toBe('/review/c1');
    expect(tapUrl({ url: '/(tabs)/check-in' })).toBe('/(tabs)/check-in');
  });

  it('ignores anything else: other sites, other schemes, missing or odd data', () => {
    expect(tapUrl({ url: 'https://example.com' })).toBeNull();
    expect(tapUrl({ url: '//example.com/x' })).toBeNull();
    expect(tapUrl({ url: 'kept://review/c1' })).toBeNull();
    expect(tapUrl({ url: 42 })).toBeNull();
    expect(tapUrl({})).toBeNull();
    expect(tapUrl(undefined)).toBeNull();
  });
});
