// What a swipe on a charity card does (owner, 2026-10-29, a little like Hinge's match list): a swipe to the left opens
// the charity's page ("Learn more"). A swipe to the right does nothing here, because on a stack screen it's iOS's
// back gesture. The distance and flick rules are the tab swipe's (tab-swipe.ts), so a drag that's mostly up or
// down stays the screen's scroll. Pure, tested in swipe-actions.test.ts.

import { swipeFrom } from './tab-swipe';

/** Whether a finished drag opens the charity's page. */
export function swipesToLearn(dx: number, dy: number, vx: number): boolean {
  return swipeFrom(dx, dy, vx) === 'next';
}
