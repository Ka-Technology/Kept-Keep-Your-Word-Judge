// Unit tests for theme.ts: every text color keeps WCAG AA contrast (4.5:1) on the surfaces it sits
// on, and field outlines keep 3:1, in both light and dark mode (SPEC.md, Boundaries).
import { bareInputStyle, bigInputStyle, DANGER_COLOR, inputStyle, PALETTES, PRIMARY_COLOR, type Colors } from './theme';

/** WCAG relative luminance of a #RRGGBB color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two #RRGGBB colors. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background, minimum] for each pairing the screens use. */
const pairs = (c: Colors): [keyof Colors, keyof Colors, number][] => [
  ...(['background', 'card', 'elevated', 'pressed'] as const).flatMap((bg) =>
    (['text', 'secondaryText', 'link', 'error'] as const).map((fg): [keyof Colors, keyof Colors, number] => [fg, bg, 4.5]),
  ),
  ['text', 'selected', 4.5],
  ['secondaryText', 'selected', 4.5],
  ['link', 'selected', 4.5],
  ['onPrimary', 'primary', 4.5],
  // A check-in to redo or appeal: the red wash tile and the red button on it.
  ['text', 'alertWash', 4.5],
  ['secondaryText', 'alertWash', 4.5],
  ['error', 'alertWash', 4.5],
  ['onPrimary', 'error', 4.5],
  ['secondaryText', 'track', 4.5],
  ['text', 'thumb', 4.5],
  ['border', 'card', 3],
  ['border', 'elevated', 3],
  // The K and X stamps and the rings are meaningful marks: 3:1 as graphics on a white tile and a washed one.
  ['stamp', 'card', 3],
  ['error', 'card', 3],
  ['stamp', 'selected', 3],
];

describe.each(Object.entries(PALETTES))('%s palette', (_mode, c) => {
  it.each(pairs(c))('%s on %s reaches %s:1', (fg, bg, min) => {
    expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(min);
  });

  it('fills the main button with the green, the one green button per screen (decision 95)', () => {
    expect(c.primary).toBe(c.stamp);
  });
});

describe('fixed colors', () => {
  it('keeps white text readable on the green and the seal red', () => {
    expect(contrast('#FFFFFF', PRIMARY_COLOR)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#FFFFFF', DANGER_COLOR)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('text box styles', () => {
  // iOS offsets a text box's text (and its hint) when it has a lineHeight, and reuses native text
  // boxes between screens, so one box's lineHeight shows up in the next screen's fields.
  it.each([
    ['inputStyle', inputStyle(PALETTES.light)],
    ['bigInputStyle', bigInputStyle(PALETTES.light)],
    ['bareInputStyle', bareInputStyle(PALETTES.light)],
  ])('%s sets no lineHeight', (_name, style) => {
    expect(style).not.toHaveProperty('lineHeight');
  });

  it('keeps the big amount at the hero size', () => {
    expect(bigInputStyle(PALETTES.light).fontSize).toBe(56);
  });
});
