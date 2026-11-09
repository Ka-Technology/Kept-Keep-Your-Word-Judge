// Unit tests for tab-swipe.ts: which tab a sideways swipe moves to, and when a drag counts as one, and what the
// Tabs screen is called in the back button's history list.
import { isSideways, neighborTab, swipeFrom, tabsTitle } from './tab-swipe';

describe('neighborTab (the tab order: Home, Challenges, Check in, Wallet, Friends)', () => {
  it('moves to the next tab and back', () => {
    expect(neighborTab('index', 'next')).toBe('challenges');
    expect(neighborTab('wallet', 'next')).toBe('friends');
    expect(neighborTab('check-in', 'previous')).toBe('challenges');
  });

  it('stops at either end instead of wrapping around', () => {
    expect(neighborTab('index', 'previous')).toBeNull();
    expect(neighborTab('friends', 'next')).toBeNull();
  });
});

describe('isSideways (when to take a drag from the screen’s scrolling)', () => {
  it('claims a clearly sideways move', () => {
    expect(isSideways(-20, 4)).toBe(true);
    expect(isSideways(20, -6)).toBe(true);
  });

  it('leaves small, vertical and diagonal moves to the scroll view', () => {
    expect(isSideways(-8, 0)).toBe(false);
    expect(isSideways(5, 40)).toBe(false);
    expect(isSideways(-30, 20)).toBe(false);
  });
});

describe('swipeFrom (a finished drag: which way, if any)', () => {
  it('a long drag to the left shows the next tab, to the right the previous', () => {
    expect(swipeFrom(-90, 10, -0.1)).toBe('next');
    expect(swipeFrom(90, -10, 0.1)).toBe('previous');
  });

  it('a short, quick flick counts too', () => {
    expect(swipeFrom(-30, 0, -0.8)).toBe('next');
  });

  it('a short, slow drag springs back', () => {
    expect(swipeFrom(-30, 0, -0.1)).toBeNull();
  });

  it('a flick against the drag springs back', () => {
    expect(swipeFrom(-90, 0, 0.8)).toBeNull();
  });
});

describe('tabsTitle (the back button\'s history list names the tab you came from, not "(tabs)")', () => {
  const on = (index: number) => ({ state: { index, routes: [{ name: 'index' }, { name: 'challenges' }, { name: 'check-in' }, { name: 'wallet' }, { name: 'friends' }] } });

  it('is the name the tab bar shows for the focused tab', () => {
    expect(tabsTitle(on(0))).toBe('Home');
    expect(tabsTitle(on(2))).toBe('Check in');
    expect(tabsTitle(on(3))).toBe('Wallet');
    expect(tabsTitle(on(4))).toBe('Friends');
  });

  it('is Home before the tabs have any state, or with a route it doesn’t know', () => {
    expect(tabsTitle({})).toBe('Home');
    expect(tabsTitle({ state: { routes: [{ name: 'index' }] } })).toBe('Home');
    expect(tabsTitle({ state: { index: 0, routes: [{ name: '+not-found' }] } })).toBe('Home');
  });
});
