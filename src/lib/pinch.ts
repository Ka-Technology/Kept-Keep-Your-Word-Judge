// The pinch-to-zoom math behind a large profile photo (components/photo-viewer.tsx; owner,
// 2026-10-03): two fingers zoom into the spot between them, like Instagram, but never scroll the photo
// around. Pure, so tested in pinch.test.ts.

/** How far a pinch can zoom in. */
export const MAX_ZOOM = 4;

/**
 * How far in, from the fingers' spread now and when the pinch began, starting from `base` (where a
 * quick second pinch caught the photo easing back): never below full size or past MAX_ZOOM. A pinch
 * that began with both fingers on one spot (no spread) stays where it began.
 */
export function pinchScale(spread: number, start: number, base = 1): number {
  return Math.min(MAX_ZOOM, Math.max(1, start > 0 ? (base * spread) / start : base));
}

/** The spot between two fingers, in points from the center of a `size`-point square photo, kept inside it. */
export function pinchFocus(a: { x: number; y: number }, b: { x: number; y: number }, size: number): { x: number; y: number } {
  const half = size / 2;
  const clamp = (v: number) => Math.min(half, Math.max(-half, v));
  return { x: clamp((a.x + b.x) / 2 - half), y: clamp((a.y + b.y) / 2 - half) };
}
