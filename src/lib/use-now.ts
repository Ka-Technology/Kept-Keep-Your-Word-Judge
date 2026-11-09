// The current time, refreshed every minute while the screen is shown, so "5h 20m left" stays true
// (Check in tab). The deadline itself never moves: it's midnight in the challenge's zone.

import { useEffect, useState } from 'react';

export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
