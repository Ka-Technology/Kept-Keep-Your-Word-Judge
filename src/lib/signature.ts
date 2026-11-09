// A drawn signature (T203, plan.md decision 171): the strokes a finger draws on the sign step's pad, as one SVG
// path in a fixed 300 × 100 box. The pad has the same shape, so the path draws back the same at any size, and the
// database stores it as text it can check (challenge_signatures.strokes, migration 0082): only M and L commands
// with numbers, nothing an SVG renderer could follow elsewhere.

/** The box every signature path is drawn in; the pad is this shape (3:1). */
export const SIGNATURE_BOX = { width: 300, height: 100 } as const;

/** The longest path the database keeps (0082's check); the pad stops taking points at it. */
export const SIGNATURE_PATH_MAX = 20000;

export type Point = { x: number; y: number };

const tenth = (n: number) => String(Math.round(n * 10) / 10);
const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max);

/**
 * Strokes drawn on a pad `width` × `height` points, as a path in SIGNATURE_BOX: an M for each stroke and an L for
 * each point after it, to a tenth. A tap (one point) is a line back to itself, which a round cap draws as a dot.
 * Points past the pad's edge stay on it.
 */
export function signaturePath(strokes: Point[][], width: number, height: number): string {
  const point = ({ x, y }: Point) =>
    `${tenth(clamp((x / width) * SIGNATURE_BOX.width, SIGNATURE_BOX.width))} ${tenth(clamp((y / height) * SIGNATURE_BOX.height, SIGNATURE_BOX.height))}`;
  return strokes
    .filter((stroke) => stroke.length > 0)
    .map((stroke) => {
      const [first, ...rest] = stroke.map(point);
      return `M${first}${(rest.length ? rest : [first]).map((p) => `L${p}`).join('')}`;
    })
    .join('');
}
