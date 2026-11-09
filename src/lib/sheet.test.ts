// Unit tests for sheet.ts: when a swipe down on a bottom sheet closes it.
import { shouldDismissSheet } from './sheet';

describe('shouldDismissSheet', () => {
  it('closes after a long drag down', () => {
    expect(shouldDismissSheet(150, 0.1)).toBe(true);
  });

  it('closes after a short, fast flick down', () => {
    expect(shouldDismissSheet(60, 1.2)).toBe(true);
  });

  it('springs back from a short, slow drag', () => {
    expect(shouldDismissSheet(60, 0.2)).toBe(false);
  });

  it('never closes on a drag up or a tap', () => {
    expect(shouldDismissSheet(-200, -2)).toBe(false);
    expect(shouldDismissSheet(0, 0)).toBe(false);
  });
});
