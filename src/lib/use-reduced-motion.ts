// Whether the phone asks for less motion (iOS Reduce Motion, Android's animation scale off). Kept's
// few animations (the stamp-down, a ring filling, a tile's press) skip straight to their final state
// when it's on (SPEC-app-shell.md, the look).

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** True while the phone's Reduce Motion setting is on; follows changes while the app runs. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let current = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => current && setReduced(on));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      current = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
