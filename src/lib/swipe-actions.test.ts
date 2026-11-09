// Unit tests for swipe-actions.ts: when a finished swipe on a charity card opens its page.

import { swipesToLearn } from './swipe-actions';

describe('swipesToLearn', () => {
  it('opens "learn more" on a clear swipe to the left', () => {
    expect(swipesToLearn(-90, 4, -0.2)).toBe(true);
  });

  it('counts a quick short flick to the left', () => {
    expect(swipesToLearn(-30, 2, -0.8)).toBe(true);
  });

  it('never acts on a swipe to the right, which is the back gesture', () => {
    expect(swipesToLearn(90, 4, 0.2)).toBe(false);
    expect(swipesToLearn(30, 2, 0.8)).toBe(false);
  });

  it('does nothing for a short, slow drag', () => {
    expect(swipesToLearn(-40, 2, -0.1)).toBe(false);
  });

  it('does nothing when the finger moved mostly up or down (a scroll)', () => {
    expect(swipesToLearn(-70, 90, -0.2)).toBe(false);
  });

  it('does nothing when the finger flicks back the other way at the end', () => {
    expect(swipesToLearn(-80, 2, 0.9)).toBe(false);
  });
});
