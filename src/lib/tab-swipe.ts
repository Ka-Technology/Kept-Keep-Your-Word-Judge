// Swiping sideways between the tabs (owner, 2026-10-02): the native tab bar doesn't, so each tab
// screen does (components/tab-swipe.tsx). Swiping left shows the next tab, right the previous, in
// the tab bar's order, stopping at either end. Pure, so tested in tab-swipe.test.ts.

import type { Href } from 'expo-router';

/** The tabs in the tab bar's order ((tabs)/_layout.tsx), by route name. */
export const TAB_ORDER = ['index', 'challenges', 'check-in', 'wallet', 'friends'] as const;
export type TabName = (typeof TAB_ORDER)[number];

/** Where each tab lives, for router.navigate. */
export const TAB_HREF: Record<TabName, Href> = {
  index: '/',
  challenges: '/challenges',
  'check-in': '/check-in',
  wallet: '/wallet',
  friends: '/friends',
};

const TAB_TITLE: Record<TabName, string> = { index: 'Home', challenges: 'Challenges', 'check-in': 'Check in', wallet: 'Wallet', friends: 'Friends' };

/**
 * What the Tabs screen is called in the back button's history list (owner, 2026-11-03: holding Back on iOS 26 still
 * lists the screens below, and this one read "(tabs)", the route group's name): the focused tab's name as the tab
 * bar shows it, from the Tabs route's own state, so it says "Wallet" when you came from Wallet. Home before the
 * tabs have a state.
 */
export function tabsTitle(route: object): string {
  // React Navigation's route type doesn't declare `state`, but a route holding a navigator has it.
  const { state } = route as { state?: { index?: number; routes: readonly { name: string }[] } };
  const name = state?.routes[state.index ?? 0]?.name;
  const tab = TAB_ORDER.find((t) => t === name);
  return tab ? TAB_TITLE[tab] : 'Home';
}

/** The tab a swipe moves to, or null at either end (it doesn't wrap around). */
export function neighborTab(tab: TabName, direction: 'next' | 'previous'): TabName | null {
  return TAB_ORDER[TAB_ORDER.indexOf(tab) + (direction === 'next' ? 1 : -1)] ?? null;
}

/** Whether a drag so far is clearly sideways, so it's a swipe and not the screen scrolling. */
export function isSideways(dx: number, dy: number): boolean {
  return Math.abs(dx) > 12 && Math.abs(dx) > 2 * Math.abs(dy);
}

/**
 * Which way a finished drag swipes (left shows the next tab), or null to spring back: it has to
 * go a good way across (60 pt), or be a quick flick, and not end in a flick the other way.
 */
export function swipeFrom(dx: number, dy: number, vx: number): 'next' | 'previous' | null {
  if (Math.abs(dy) > Math.abs(dx)) return null;
  const flick = Math.abs(vx) >= 0.5;
  if (flick && Math.sign(vx) !== Math.sign(dx)) return null;
  if (Math.abs(dx) < 60 && !(flick && Math.abs(dx) >= 20)) return null;
  return dx < 0 ? 'next' : 'previous';
}
