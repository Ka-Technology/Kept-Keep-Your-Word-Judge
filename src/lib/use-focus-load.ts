// Loads data each time a screen comes into view, and again when the app comes back from the
// background while it's showing (a day may have ended overnight; review, 2026-10-04): the pattern most
// screens here share. `data` is null
// until the first answer, `failed` offers a retry through `reload`, and an answer that arrives after
// the screen has lost focus is ignored. `load` throws (or rejects) to report a failure; `must()`
// turns a Supabase reply into its data or a throw.

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/** A Supabase reply's data, or a throw with its error. */
export function must<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw error;
  return data;
}

/**
 * Runs `load` on focus. It reruns when `key` changes (e.g. the id being shown); a null or undefined
 * key waits, for a screen whose id or user isn't known yet.
 */
export function useFocusLoad<T>(
  load: () => Promise<T>,
  key: string | null | undefined = '',
): { data: T | null; failed: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  // The newest `load`, so the focus callback needn't change when the screen re-renders.
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });

  // The showing screen's fetch, for `reload`.
  const fetchNow = useRef(() => {});

  const run = useCallback(() => {
    if (key === null || key === undefined) return;
    let current = true;
    const fetch = () =>
      latest.current().then(
        (result) => {
          if (!current) return;
          setData(result);
          setFailed(false);
        },
        () => {
          if (current) setFailed(true);
        },
      );
    fetchNow.current = () => void fetch();
    void fetch();
    const foreground = AppState.addEventListener('change', (state) => state === 'active' && void fetch());
    return () => {
      current = false;
      foreground.remove();
    };
  }, [key]);
  useFocusEffect(run);

  return { data, failed, reload: () => fetchNow.current() };
}
