// Pins the pinch-to-zoom math behind a large profile photo (components/photo-viewer.tsx; owner,
// 2026-10-03): how far in, and the spot it zooms toward.

import { MAX_ZOOM, pinchFocus, pinchScale } from './pinch';

describe('pinchScale (how far in)', () => {
  it('follows the fingers spreading, between full size and the maximum', () => {
    expect(pinchScale(300, 100)).toBe(3);
    expect(pinchScale(500, 100)).toBe(MAX_ZOOM);
    expect(pinchScale(50, 100)).toBe(1);
  });

  it('starts from where a quick second pinch caught the photo, not from full size', () => {
    expect(pinchScale(100, 100, 2.5)).toBe(2.5);
    expect(pinchScale(200, 100, 2.5)).toBe(MAX_ZOOM);
    expect(pinchScale(50, 100, 2.5)).toBe(1.25);
  });

  it('stays at full size when the pinch began with both fingers on one spot', () => {
    expect(pinchScale(0, 0)).toBe(1);
    expect(pinchScale(40, 0)).toBe(1);
  });
});

describe('pinchFocus (the spot between the fingers, from the photo’s center)', () => {
  it('is the midpoint, measured from the center', () => {
    expect(pinchFocus({ x: 150, y: 150 }, { x: 150, y: 150 }, 300)).toEqual({ x: 0, y: 0 });
    expect(pinchFocus({ x: 0, y: 0 }, { x: 100, y: 40 }, 300)).toEqual({ x: -100, y: -130 });
  });

  it('stays inside the photo', () => {
    expect(pinchFocus({ x: 400, y: -50 }, { x: 500, y: -10 }, 300)).toEqual({ x: 150, y: -150 });
  });
});
