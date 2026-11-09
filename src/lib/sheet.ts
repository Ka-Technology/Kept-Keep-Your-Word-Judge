// When a swipe down on a bottom sheet (BottomPanel) closes it: a long drag, or a short fast flick (vy in px/ms).
export const shouldDismissSheet = (dy: number, vy: number) => dy > 120 || (dy > 40 && vy > 0.8);
