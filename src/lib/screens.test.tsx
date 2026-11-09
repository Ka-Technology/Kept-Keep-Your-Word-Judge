/// <reference types="node" />
// The real screens (src/app, the real guards and auth provider) on a fake Supabase, through the paths a pure-function
// test can't see: which screen a chain of async answers lands on, and what's left to tap when an answer never comes.
// Only what crosses a boundary is faked: Supabase, Stripe, Google, the phone's storage and clipboard. Native views
// don't render here, so what only a phone can show (a modal's timing, iOS's Paste menu) stays a manual check.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { router } from 'expo-router';
import { act, cleanup, fireEvent, renderRouter, screen, type RenderRouterResult } from 'expo-router/testing-library';
import path from 'node:path';
import { Alert } from 'react-native';

import { CardDeclined } from '@/lib/payment-methods';
import { clearProfileDraft, saveProfileDraft } from '@/lib/profile-draft';
import { markTutorialSeen } from '@/lib/tutorial';

process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web';
process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios';
process.env.EXPO_PUBLIC_DEMO_CLOCK = 'always';
process.env.EXPO_PUBLIC_SOLANA_PAY = 'devnet';

const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

/** What the fakes answer with, and what they've seen; reset before each test. */
const mockS: any = {};

function mockFreshState() {
  Object.assign(mockS, {
    cb: null,
    session: null,
    initialSession: 'answers',
    profiles: {},
    inserts: 0,
    insertError: null,
    profileRead: 'ok',
    releaseProfile: null,
    verifyCalls: [],
    verifyError: null,
    enrolled: [],
    clipboard: '',
    payer: null,
    boom: false,
    challenges: [],
    reload: jest.fn(),
    invoke: jest.fn(async () => ({ data: {}, error: null })),
    idToken: async () => ({ data: {}, error: null }),
    googleSignIn: async () => ({ type: 'cancelled' }),
    switchCard: jest.fn(async () => true),
    payByCard: jest.fn(async () => 'paid'),
  });
}
mockFreshState();

function mockNewSession(factors: object[] = []) {
  return {
    access_token: `h.${Buffer.from(JSON.stringify({ aal: 'aal1' })).toString('base64')}.s`,
    user: { id: 'u1', email: 'a@b.co', factors, app_metadata: { provider: 'email' } },
  };
}

jest.mock('@/lib/supabase', () => {
  const query = (table: string) => {
    let inserted: any = null;
    let single = false;
    const b: any = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'is', 'not', 'gte', 'lte', 'or', 'filter', 'match', 'range', 'update', 'upsert', 'delete']) b[m] = () => b;
    b.insert = (row: any) => {
      inserted = row;
      return b;
    };
    b.single = b.maybeSingle = () => {
      single = true;
      return b;
    };
    b.then = (res: any, rej: any) => {
      const answer = (data: unknown, error: unknown = null) => Promise.resolve({ data, error, count: 0 }).then(res, rej);
      const rows: any = {
        habits: [{ id: 'read', name: 'Read', position: 1, check_summary: 'A photo' }],
        charities: single ? { name: 'A charity' } : [],
        challenges: inserted && single ? { id: 'c2' } : [],
        solana_payments: single ? (mockS.payer ? { payer: mockS.payer, escrow: null } : null) : [],
      };
      if (table !== 'profiles') return answer(rows[table] ?? (single ? null : []));
      const own = () => mockS.profiles[mockS.session?.user.id] ?? null;
      if (inserted) {
        mockS.inserts++;
        if (mockS.insertError) return answer(null, mockS.insertError);
        mockS.profiles[inserted.id] = { showcase_badges: [], avatar_path: null, health_allowed: null, ...inserted };
        return answer(own());
      }
      if (mockS.profileRead === 'hang') return new Promise(() => {}).then(res, rej);
      if (mockS.profileRead === 'reject') return Promise.reject(new TypeError('Network request failed')).then(res, rej);
      if (mockS.profileRead === 'held' && mockS.inserts > 0) {
        return new Promise((done) => {
          mockS.releaseProfile = () => done({ data: own(), error: null, count: 0 });
        }).then(res, rej);
      }
      return answer(own());
    };
    return b;
  };
  return {
    AUTH_STORAGE_KEY: 'kept-auth',
    authStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
    supabase: {
      auth: {
        onAuthStateChange: (cb: any) => {
          mockS.cb = cb;
          if (mockS.initialSession === 'answers') setTimeout(() => cb('INITIAL_SESSION', mockS.session), 0);
          return { data: { subscription: { unsubscribe() {} } } };
        },
        verifyOtp: async ({ token }: { token: string }) => {
          mockS.verifyCalls.push(token);
          if (mockS.verifyError) return { data: {}, error: mockS.verifyError };
          mockS.session = mockNewSession();
          await mockS.cb('SIGNED_IN', mockS.session);
          return { data: {}, error: null };
        },
        signInWithIdToken: async () => {
          const out = await mockS.idToken();
          if (!out.error) {
            mockS.session = mockNewSession();
            await mockS.cb('SIGNED_IN', mockS.session);
          }
          return out;
        },
        signOut: async () => ({ error: null }),
        getSession: async () => ({ data: { session: mockS.session }, error: null }),
        getUser: async () => ({ data: { user: mockS.session?.user }, error: null }),
        refreshSession: async () => ({ data: { session: mockS.session }, error: null }),
        startAutoRefresh() {},
        stopAutoRefresh() {},
        mfa: {
          listFactors: async () => ({ data: { all: [], totp: [] }, error: null }),
          enroll: async (options: object) => {
            mockS.enrolled.push(options);
            return { data: { id: 'f1', totp: { uri: 'otpauth://x', secret: 'SECRET' } }, error: null };
          },
        },
      },
      from: query,
      rpc: async () => ({ data: [], error: null }),
      functions: { invoke: (...args: unknown[]) => mockS.invoke(...args) },
      storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
      channel: () => ({
        on() {
          return this;
        },
        subscribe() {
          return this;
        },
        unsubscribe() {},
      }),
      removeChannel() {},
    },
  };
});
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo-google-fonts/bricolage-grotesque', () => ({ useFonts: () => [true, null], BricolageGrotesque_600SemiBold: 1, BricolageGrotesque_700Bold: 1, BricolageGrotesque_800ExtraBold: 1 }));
jest.mock('@stripe/stripe-react-native', () => ({ StripeProvider: ({ children }: { children: unknown }) => children, handleURLCallback: async () => {}, handleNextAction: async () => ({}), initPaymentSheet: async () => ({}), presentPaymentSheet: async () => ({}), PaymentSheetError: { Canceled: 'Canceled' } }));
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure() {}, signIn: () => mockS.googleSignIn(), revokeAccess: async () => {} },
  isCancelledResponse: (r: { type: string }) => r.type === 'cancelled',
}));
jest.mock('react-native-view-shot', () => ({ captureScreen: async () => '', releaseCapture() {} }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('expo-clipboard', () => ({ getStringAsync: async () => mockS.clipboard }));
jest.mock('@/lib/quick-sign-in', () => ({
  deviceQuickSignIn: { turnOff: async () => {}, turnOn: async () => {}, signIn: async () => ({ kind: 'none' }) },
  useQuickSignIn: () => ({ name: null, choice: 'off', refresh() {} }),
  confirmWithBiometrics: async () => false,
}));
jest.mock('@/lib/notifications', () => ({ registerPushToken: async () => {}, rescheduleShieldWarnings: async () => {}, stopShieldWarnings: async () => {}, forgetPushToken: async () => {}, useNotificationTaps: () => {}, askForNotifications: async () => {} }));
jest.mock('@/lib/use-my-challenges', () => ({ useMyChallenges: () => ({ challenges: mockS.challenges, failed: false, reload: mockS.reload }) }));
jest.mock('@/lib/payment-methods', () => ({
  ...jest.requireActual('@/lib/payment-methods'),
  ensureCard: async () => true,
  switchCard: (...args: unknown[]) => mockS.switchCard(...args),
  payByCard: (...args: unknown[]) => mockS.payByCard(...args),
  stripeEnabled: () => true,
}));
// A finger on the pad is a gesture native views handle; here a press signs.
jest.mock('@/components/signature-pad', () => {
  const { createElement } = jest.requireActual('react');
  const { Pressable } = jest.requireActual('react-native');
  return { SignaturePad: ({ onChange }: { onChange: (s: object) => void }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: 'Sign here', onPress: () => onChange({ strokes: [] }) }) };
});
// The one component only the email path draws, used here as a screen that throws.
jest.mock('@/components/kept-mark', () => ({
  KeptMark: () => {
    if (mockS.boom) throw new Error('boom in a screen');
    return null;
  },
}));

jest.setTimeout(120000);

let app: RenderRouterResult;
const realFetch = global.fetch;

/**
 * Lets a chain of async answers and effects finish, with `ms` on the clock. React Native's jest setup runs promises on
 * setImmediate, so each step needs the fake clock to tick, and React applies state when an act ends, so it takes several.
 */
async function flush(ms = 50) {
  for (let round = 0; round < 8; round++) {
    await act(async () => {
      for (let i = 0; i < 30; i++) {
        jest.advanceTimersByTime(round === 0 && i === 0 ? ms : 1);
        await Promise.resolve();
      }
    });
  }
}
async function open(url = '/') {
  app = await renderRouter(path.resolve(__dirname, '../app'), { initialUrl: url });
  await flush(20);
}
const text = (t: string | RegExp) => screen.queryAllByText(t, { includeHiddenElements: true }).length > 0;
const buttons = (name: string | RegExp) => screen.queryAllByRole('button', { name, includeHiddenElements: true });
async function press(name: string | RegExp) {
  await fireEvent.press(buttons(name)[0]);
  await flush();
}
async function go(href: Parameters<typeof router.push>[0]) {
  await act(async () => router.push(href));
  await flush();
}
async function typeCode(code: string) {
  await fireEvent.changeText(screen.getByLabelText('6-digit code', { includeHiddenElements: true }), code);
  await flush();
}
/** The steps of a new email account, up to its code screen. */
async function openVerify() {
  await open();
  await go('/sign-up');
  await go({ pathname: '/verify', params: { email: 'a@b.co' } });
}
function typedOnSignUp() {
  saveProfileDraft('a@b.co', { firstName: 'A', lastName: 'B', username: 'aabbcc', dob: new Date(1990, 0, 1), stateCode: 'OR', aiAllowed: true });
}
async function signedIn(factors: object[] = []) {
  mockS.session = mockNewSession(factors);
  mockS.profiles.u1 = { id: 'u1', username: 'aabbcc', first_name: 'A', last_name: 'B', showcase_badges: [], ai_allowed: true };
  await markTutorialSeen('u1');
}
/** The native screen a route is drawn in, from the rendered tree. */
function nativeScreen(id: string, node: any = screen.toJSON()): any {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map((n) => nativeScreen(id, n)).find(Boolean) ?? null;
  if (node.type === 'RNSScreen' && String(node.props.screenId).startsWith(`${id}:`)) return node;
  return nativeScreen(id, node.children);
}
function challenge(over: object = {}) {
  return {
    id: 'c1',
    habitId: 'read',
    title: 'Read',
    language: null,
    level: null,
    charityName: 'A charity',
    stakeDollars: 25,
    paymentName: 'Card',
    isPublic: false,
    lengthDays: 28,
    startDate: '2026-11-01',
    timeZone: 'America/Los_Angeles',
    today: 5,
    daysCompleted: 2,
    daysRequired: 28,
    shieldsLeft: 2,
    shieldsTotal: 2,
    missedDays: [],
    boughtShields: 0,
    revival: null,
    underReview: false,
    state: 'active',
    endedOnDay: null,
    quit: false,
    checkedInToday: false,
    todayText: null,
    days: [],
    ...over,
  };
}

beforeEach(async () => {
  jest.useFakeTimers();
  mockFreshState();
  clearProfileDraft();
  await AsyncStorage.clear();
  // React's act warnings and the screens' own console output say nothing about what these tests check.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  await cleanup();
  jest.clearAllTimers();
  jest.restoreAllMocks();
  global.fetch = realFetch;
});

describe('an email sign-up', () => {
  it('goes from the code to Home with one save, and opens the tutorial', async () => {
    await openVerify();
    typedOnSignUp();
    await typeCode('123456');
    expect(mockS.inserts).toBe(1);
    expect(app.getPathname()).toBe('/tutorial');
    expect(text('Welcome to Kept')).toBe(true);
    expect(text(/^Good (morning|afternoon|evening), A$/)).toBe(true);
  });

  // Regression, 2026-11-06: a loading screen here took the navigator down while complete-profile was still sliding in.
  it('keeps the navigator up from the save to Home, with no loading screen', async () => {
    mockS.profileRead = 'held';
    await openVerify();
    typedOnSignUp();
    await typeCode('123456');
    expect(mockS.inserts).toBe(1);
    expect(screen.queryAllByLabelText('Loading', { includeHiddenElements: true })).toHaveLength(0);
    expect(text('Setting up your account…')).toBe(true);
    await act(async () => mockS.releaseProfile());
    await flush();
    expect(app.getPathname()).toBe('/tutorial');
  });

  // Regression, 2026-11-06: as a modal, presented during the guards' own transition, it could come up empty.
  it('opens the tutorial as a push, not a modal', async () => {
    await openVerify();
    typedOnSignUp();
    await typeCode('123456');
    expect(nativeScreen('tutorial').props.stackPresentation).toBe('push');
  });

  it('shows the form with what was typed when the username was taken meanwhile', async () => {
    mockS.insertError = { code: '23505', message: 'profiles_username_key' };
    await openVerify();
    typedOnSignUp();
    await typeCode('123456');
    expect(app.getPathname()).toBe('/complete-profile');
    expect(text('Almost there')).toBe(true);
    expect(screen.getByDisplayValue('aabbcc', { includeHiddenElements: true })).toBeTruthy();
    expect(text(/taken/i)).toBe(true);
  });

  it('stays on the code screen after a wrong code, and takes another', async () => {
    mockS.verifyError = { code: 'otp_expired' };
    await openVerify();
    await typeCode('123456');
    expect(app.getPathname()).toBe('/verify');
    expect(text(/didn't work/)).toBe(true);
    mockS.verifyError = null;
    await typeCode('654321');
    expect(mockS.verifyCalls).toEqual(['123456', '654321']);
  });
});

describe('a call that never answers', () => {
  it('shows Try again after 15 seconds when the profile read hangs, and Try again works', async () => {
    mockS.profileRead = 'hang';
    await openVerify();
    await typeCode('123456');
    expect(text(/Couldn't load your account/)).toBe(false);
    await flush(15100);
    expect(text(/Couldn't load your account/)).toBe(true);
    mockS.profileRead = 'ok';
    await press('Try again');
    expect(app.getPathname()).toBe('/complete-profile');
  });

  it('shows Try again at once when the profile read rejects', async () => {
    mockS.profileRead = 'reject';
    await openVerify();
    await typeCode('123456');
    expect(text(/Couldn't load your account/)).toBe(true);
  });

  it('shows Try again when the session store hangs, and a late answer still lands', async () => {
    mockS.initialSession = 'hangs';
    await open();
    await flush(15100);
    expect(text(/Couldn't load your account/)).toBe(true);
    await act(async () => mockS.cb('INITIAL_SESSION', null));
    await flush();
    expect(text('Welcome back')).toBe(true);
  });

  it('frees the sign-in screen after 3 minutes when Google’s sheet hangs', async () => {
    mockS.googleSignIn = () => new Promise(() => {});
    await open();
    await press('Continue with Google');
    expect(text('Signing in…')).toBe(true);
    await flush(180100);
    expect(text('Signing in…')).toBe(false);
    expect(text(/Couldn't reach Kept/)).toBe(true);
  });

  it('frees the sign-in screen after 30 seconds when Google’s token exchange hangs', async () => {
    mockS.googleSignIn = async () => ({ type: 'success', data: { idToken: 't' } });
    mockS.idToken = () => new Promise(() => {});
    await open();
    await press('Continue with Google');
    await flush(30100);
    expect(text('Signing in…')).toBe(false);
    expect(text(/Couldn't reach Kept/)).toBe(true);
  });

  it('lands a new Google account on complete-profile when it all answers', async () => {
    mockS.googleSignIn = async () => ({ type: 'success', data: { idToken: 't' } });
    await open();
    await press('Continue with Google');
    expect(app.getPathname()).toBe('/complete-profile');
  });
});

describe('a screen that throws', () => {
  it('shows a way out instead of a black screen, and names the error in the test build', async () => {
    mockS.boom = true;
    await openVerify();
    typedOnSignUp();
    await typeCode('123456');
    expect(text('Something went wrong on this screen.')).toBe(true);
    expect(text('boom in a screen')).toBe(true);
    expect(buttons('Try again')).toHaveLength(1);
  });
});

describe('pasting a code', () => {
  it('says so when the clipboard holds no code, and sends nothing', async () => {
    mockS.clipboard = 'hello world';
    await openVerify();
    await press('Paste code');
    expect(text(/No 6-digit code on your clipboard/)).toBe(true);
    expect(mockS.verifyCalls).toEqual([]);
  });

  it('finds the code in a copied sentence, from the button', async () => {
    mockS.clipboard = 'Your Kept code is 123 456. It lasts 15 minutes.';
    await openVerify();
    await press('Paste code');
    expect(mockS.verifyCalls).toEqual(['123456']);
  });

  it('finds the code in a sentence pasted into the boxes, ignoring the other numbers', async () => {
    await openVerify();
    await typeCode('expires in 15 minutes: 123456');
    expect(mockS.verifyCalls).toEqual(['123456']);
  });

  it('leaves the boxes able to take touches, which iOS’s Paste menu needs', async () => {
    await openVerify();
    const input = screen.getByLabelText('6-digit code', { includeHiddenElements: true });
    const style = [input.props.style].flat(5).reduce((all: object, s: object) => ({ ...all, ...s }), {});
    expect(input.props.pointerEvents).toBeUndefined();
    expect(style.opacity).toBeUndefined();
  });
});

describe('two-step verification', () => {
  const refused = (code: string) => async () => ({ data: null, error: new FunctionsHttpError({ json: async () => ({ error: code }) }) });
  // No connection: the error's context is what fetch threw, with no body to read.
  const offline = async () => ({ data: null, error: new FunctionsFetchError(new TypeError('Network request failed')) });

  it('says the email failed and stays put, without asking to wait a minute', async () => {
    await signedIn([{ factor_type: 'totp', status: 'verified', id: 'f' }]);
    mockS.invoke = refused('email_not_configured');
    await open();
    expect(app.getPathname()).toBe('/two-step');
    await press('Lost your authenticator app?');
    expect(text('Couldn’t send the email. Try again in a little while.')).toBe(true);
    expect(text('Check your email')).toBe(false);
  });

  it('opens the code screen when asked twice in a minute, since the first code still works', async () => {
    await signedIn([{ factor_type: 'totp', status: 'verified', id: 'f' }]);
    mockS.invoke = refused('wait_a_minute');
    await open();
    await press('Lost your authenticator app?');
    expect(text('Check your email')).toBe(true);
    expect(text(/just emailed you a code/)).toBe(true);
  });

  // Regression, 2026-11-06: reading a body that isn't there threw, so the tap did nothing at all.
  it('says the email failed when there’s no connection', async () => {
    await signedIn([{ factor_type: 'totp', status: 'verified', id: 'f' }]);
    mockS.invoke = offline;
    await open();
    await press('Lost your authenticator app?');
    expect(text('Couldn’t send the email. Try again in a little while.')).toBe(true);
  });

  it('says so when the connection drops while checking the emailed code', async () => {
    await signedIn([{ factor_type: 'totp', status: 'verified', id: 'f' }]);
    await open();
    await press('Lost your authenticator app?');
    mockS.invoke = offline;
    await typeCode('123456');
    expect(text(/Couldn’t reach Kept/)).toBe(true);
  });

  it('opens the code screen when the email went', async () => {
    await signedIn([{ factor_type: 'totp', status: 'verified', id: 'f' }]);
    await open();
    await press('Lost your authenticator app?');
    expect(text('Check your email')).toBe(true);
  });

  // Regression, 2026-11-06: without it the authenticator listed the project's site URL, localhost:3000.
  it('names Kept as the issuer the authenticator app shows', async () => {
    await signedIn();
    await open();
    await go('/settings/two-step');
    await press('Turn on');
    expect(mockS.enrolled[0].issuer).toBe('Kept');
  });
});

describe('signing out and back in', () => {
  it('lands on sign-in from a deep screen, and on Home after signing in again', async () => {
    await signedIn();
    await open();
    await go('/settings/two-step');
    await act(async () => {
      mockS.session = null;
      await mockS.cb('SIGNED_OUT', null);
    });
    await flush();
    expect(app.getPathname()).toBe('/sign-in');
    expect(text('Welcome back')).toBe(true);
    await act(async () => {
      mockS.session = mockNewSession();
      await mockS.cb('SIGNED_IN', mockS.session);
    });
    await flush();
    expect(app.getPathname()).toBe('/');
  });
});

describe('the demo clock on a failed challenge', () => {
  const failedToday = () => challenge({ state: 'not_finished', endedOnDay: 5, today: 5, shieldsLeft: 0 });

  it('moves a challenge that failed today, from its screen', async () => {
    await signedIn();
    mockS.challenges = [failedToday()];
    await open('/challenge/c1');
    expect(text(/when you can buy a shield/)).toBe(true);
    await press('Next day (demo)');
    expect(mockS.invoke).toHaveBeenCalledWith('ai-check', { body: { challengeId: 'c1', nextDay: true } });
    expect(mockS.reload).toHaveBeenCalled();
  });

  it('is on the results screen too', async () => {
    await signedIn();
    mockS.challenges = [failedToday()];
    await open('/challenge/c1/results');
    expect(buttons('Next day (demo)')).toHaveLength(1);
  });

  it('gives way to the offer once it opens, since another day would close it', async () => {
    await signedIn();
    mockS.challenges = [challenge({ state: 'not_finished', endedOnDay: 5, today: 6, shieldsLeft: 0, revival: { priceCents: 500, charityCents: 250, keptCents: 250 } })];
    await open('/challenge/c1');
    expect(buttons('Next day (demo)')).toHaveLength(0);
    expect(buttons(/Keep going with a shield/)).toHaveLength(1);
  });

  it('never shows on a challenge the user quit', async () => {
    await signedIn();
    mockS.challenges = [challenge({ state: 'not_finished', endedOnDay: 5, today: 5, quit: true })];
    await open('/challenge/c1');
    expect(buttons('Next day (demo)')).toHaveLength(0);
  });

  it('says so when the clock fails, and stays usable', async () => {
    await signedIn();
    mockS.challenges = [failedToday()];
    mockS.invoke = jest.fn(async () => ({ data: null, error: new Error('nope') }));
    await open('/challenge/c1');
    await press('Next day (demo)');
    expect(text(/Couldn’t move to the next day/)).toBe(true);
    expect(buttons('Next day (demo)')).toHaveLength(1);
  });
});

describe('changing how you pay', () => {
  const unpaidCard = () => challenge({ state: 'upcoming', today: 0, awaitingPayment: true, awaitingCard: true });
  const draft = { habitId: 'read', habitName: 'Read', days: '28' };

  /** The last three steps of a new card challenge, with the promise signed and a first try declined. */
  async function declinedOnSign() {
    mockS.payByCard = jest.fn(async () => {
      throw new CardDeclined('Your card was declined.');
    });
    await signedIn();
    await open();
    await go({ pathname: '/challenge/new/stake', params: draft });
    await go({ pathname: '/challenge/new/charity', params: { ...draft, stake: '25', payment: 'card' } });
    await go({ pathname: '/challenge/new/sign', params: { ...draft, stake: '25', payment: 'card', charityId: 'ch1', charityName: 'A charity' } });
    await press('Sign here');
    await press('Sign and start');
  }

  it('says why on the Sign step, and offers another card and another way', async () => {
    await declinedOnSign();
    expect(text('Your card was declined.')).toBe(true);
    expect(buttons('Use a different card')).toHaveLength(1);
    expect(buttons('Pay another way')).toHaveLength(1);
  });

  it('signs and pays again with the new card, and opens the challenge', async () => {
    await declinedOnSign();
    mockS.payByCard = jest.fn(async () => 'paid');
    await press('Use a different card');
    expect(mockS.switchCard).toHaveBeenCalledWith('u1');
    expect(mockS.payByCard).toHaveBeenCalledTimes(1);
    expect(app.getPathname()).toBe('/challenge/c2');
  });

  it('charges nothing when the card form is closed', async () => {
    await declinedOnSign();
    mockS.switchCard = jest.fn(async () => false);
    mockS.payByCard = jest.fn(async () => 'paid');
    await press('Use a different card');
    expect(mockS.payByCard).not.toHaveBeenCalled();
    expect(app.getPathname()).toBe('/challenge/new/sign');
  });

  it('opens the card form once on a double tap', async () => {
    await declinedOnSign();
    const card = buttons('Use a different card')[0];
    mockS.switchCard = jest.fn(async () => {
      // The second tap, with the form still open.
      if (mockS.switchCard.mock.calls.length === 1) await fireEvent.press(card);
      return false;
    });
    await fireEvent.press(card);
    await flush();
    expect(mockS.switchCard).toHaveBeenCalledTimes(1);
  });

  it('says why when the card form fails', async () => {
    await declinedOnSign();
    mockS.switchCard = jest.fn(async () => {
      throw new CardDeclined('That card was refused.');
    });
    await press('Use a different card');
    expect(text('That card was refused.')).toBe(true);
  });

  it('goes back to the Stake step already in the stack, with the draft', async () => {
    await declinedOnSign();
    await press('Pay another way');
    expect(app.getPathname()).toBe('/challenge/new/stake');
    expect(app.getSearchParams()).toMatchObject(draft);
    expect(text('Sign your promise')).toBe(false);
    expect(nativeScreen('challenge/new/sign')).toBeNull();
  });

  // Regression, 2026-11-06: a decline removes the challenge, and the screen said only that it couldn't be loaded.
  it('says why a card was declined on the challenge’s screen, and starts again at the Stake step', async () => {
    await signedIn();
    mockS.challenges = [unpaidCard()];
    mockS.payByCard = jest.fn(async () => {
      throw new CardDeclined('Your card was declined.');
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await open('/challenge/c1');
    await press('Pay by card');
    expect(alert.mock.calls[0][1]).toContain('Your card was declined.');
    const again = alert.mock.calls[0][2]!.find((b) => b.text === 'Start again')!;
    await act(async () => again.onPress!());
    await flush();
    expect(app.getPathname()).toBe('/challenge/new/stake');
    expect(app.getSearchParams()).toMatchObject({ habitId: 'read', days: '28' });
  });

  it('keeps the challenge when the connection drops mid-payment, and can be retried', async () => {
    await signedIn();
    mockS.challenges = [unpaidCard()];
    mockS.payByCard = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await open('/challenge/c1');
    await press('Pay by card');
    expect(alert).not.toHaveBeenCalled();
    expect(text(/Couldn’t reach Kept/)).toBe(true);
    expect(buttons('Pay by card')).toHaveLength(1);
  });

  it.each([
    ['the challenge’s screen, by card', () => unpaidCard(), '/challenge/c1', 'payments'],
    ['the wallet’s Pay sheet', () => challenge({ state: 'upcoming', today: 0, awaitingPayment: true, paymentName: 'Solana (USDC)' }), '/challenge/c1/pay', 'solana-pay'],
  ])('asks first, removes the unpaid challenge and reopens the Stake step from %s', async (_where, unpaid, url, rail) => {
    await signedIn();
    mockS.challenges = [unpaid()];
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await open(url);
    await press('Pay another way');
    expect(mockS.invoke).not.toHaveBeenCalledWith(rail, { body: { action: 'cancel', challenge: 'c1' } });
    const remove = alert.mock.calls[0][2]!.find((b) => b.style === 'destructive')!;
    await act(async () => remove.onPress!());
    await flush();
    expect(mockS.invoke).toHaveBeenCalledWith(rail, { body: { action: 'cancel', challenge: 'c1' } });
    expect(app.getPathname()).toBe('/challenge/new/stake');
    expect(app.getSearchParams()).toMatchObject({ habitId: 'read', days: '28' });
  });

  it('offers none of it on a paid challenge', async () => {
    await signedIn();
    mockS.challenges = [challenge()];
    await open('/challenge/c1');
    expect(buttons('Pay by card')).toHaveLength(0);
    expect(buttons('Pay another way')).toHaveLength(0);
  });
});

describe('the wallet’s balance', () => {
  const rpc = (accounts: object[]) => jest.fn(async () => ({ json: async () => ({ result: { value: accounts } }) })) as unknown as typeof fetch;
  const token = (mint: string, ui: string) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { uiAmountString: ui } } } } } });

  it('shows the wallet that last paid, with no setup', async () => {
    await signedIn();
    mockS.payer = WALLET;
    // One answer per token program; this fake gives the one account to both.
    global.fetch = rpc([token(USDC, '12.5')]);
    await open('/wallet');
    expect(text('Your Solana wallet')).toBe(true);
    expect(text('USDC')).toBe(true);
    expect(text('25')).toBe(true);
    expect(text(/7xKX…gAsU/)).toBe(true);
  });

  it('checks a pasted address, then saves and reads it', async () => {
    await signedIn();
    global.fetch = rpc([]);
    await open('/wallet');
    mockS.clipboard = '395033';
    await press(/See what’s in your wallet/);
    expect(text(/That isn’t a Solana address/)).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();

    mockS.clipboard = `  ${WALLET}\n`;
    await press(/See what’s in your wallet/);
    expect(text('USDC')).toBe(true);
    expect(await AsyncStorage.getItem('kept.solanaWallet.u1')).toBe(WALLET);
  });

  it('offers a retry when the network fails, and the rest of Wallet still shows', async () => {
    await signedIn();
    mockS.payer = WALLET;
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await open('/wallet');
    expect(buttons(/Couldn’t read your wallet/)).toHaveLength(1);
    expect(text('Kept credits')).toBe(true);
  });

  // Regression, 2026-11-06: a saved address the RPC refuses (a Bitcoin address fits the pattern) left only "try again", for good.
  it('can replace a saved wallet that can’t be read', async () => {
    await signedIn();
    await AsyncStorage.setItem('kept.solanaWallet.u1', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
    global.fetch = jest.fn(async () => ({ json: async () => ({ error: { code: -32602 } }) })) as unknown as typeof fetch;
    await open('/wallet');
    expect(buttons(/Couldn’t read your wallet/)).toHaveLength(1);

    global.fetch = rpc([token(USDC, '12.5')]);
    mockS.clipboard = WALLET;
    await press(/Use a different wallet/);
    expect(text('25')).toBe(true);
    expect(buttons(/Couldn’t read your wallet/)).toHaveLength(0);
  });

  it('doesn’t leave the last wallet’s balances up for one it can’t read', async () => {
    await signedIn();
    mockS.payer = WALLET;
    global.fetch = rpc([token(USDC, '12.5')]);
    await open('/wallet');
    expect(text('25')).toBe(true);

    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    mockS.clipboard = 'So11111111111111111111111111111111111111112';
    await press(/Use a different wallet/);
    expect(text('25')).toBe(false);
    expect(text(/7xKX…gAsU/)).toBe(false);
    expect(buttons(/Couldn’t read your wallet/)).toHaveLength(1);
  });

  it('counts an error from the RPC as failed, not as an empty wallet', async () => {
    await signedIn();
    mockS.payer = WALLET;
    global.fetch = jest.fn(async () => ({ json: async () => ({ error: { code: 429 } }) })) as unknown as typeof fetch;
    await open('/wallet');
    expect(buttons(/Couldn’t read your wallet/)).toHaveLength(1);
    expect(text('USDC')).toBe(false);
  });
});
