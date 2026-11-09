// Loads the signed-in user's challenges (or one of them) as ChallengeSummary, newest first. It
// reloads each time the screen comes back into view, or the app back from the background
// (useFocusLoad), so a new challenge, check-in or day shows at once.
// It asks for the user's own rows by id: friends' challenges are readable too (T23).
// It also records any ending the rules see but the database doesn't have yet, and opens that
// challenge's results screen (T20), whichever screen was loading.

import { router } from 'expo-router';

import { useAuth } from '@/lib/auth';
import { CHALLENGE_COLUMNS, outcomeUpdate, summarizeChallenge, type ChallengeRow, type ChallengeSummary } from '@/lib/challenges';
import { supabase } from '@/lib/supabase';
import { must, useFocusLoad } from '@/lib/use-focus-load';

/** `challenges` is null until the first load; `failed` offers a retry through `reload`. */
export function useMyChallenges(id?: string): { challenges: ChallengeSummary[] | null; failed: boolean; reload: () => void } {
  const userId = useAuth().session?.user.id;
  const { data, failed, reload } = useFocusLoad(
    async () => {
      let query = supabase.from('challenges').select(CHALLENGE_COLUMNS).eq('user_id', userId!).order('created_at', { ascending: false });
      if (id) query = query.eq('id', id);
      const rows = must(await query) as unknown as ChallengeRow[];
      const now = new Date();
      recordEndings(rows, now);
      return rows.map((row) => summarizeChallenge(row, now));
    },
    userId && `${userId}:${id ?? ''}`,
  );
  return { challenges: data, failed, reload };
}

/**
 * Records each newly ended challenge's outcome, then opens the first one's results. The update only
 * applies while no outcome is recorded, so if two screens race, only one opens the results. A
 * failed update is tried again on the next load; until then the screens already show the ending.
 */
async function recordEndings(rows: ChallengeRow[], now: Date) {
  let opened = false;
  for (const row of rows) {
    const update = outcomeUpdate(row, now);
    if (!update) continue;
    const { data } = await supabase.from('challenges').update(update).eq('id', row.id).is('outcome', null).select('id');
    // ponytail: only the first ending opens its results; the others are one tap away on their detail screen.
    if (data?.length && !opened) {
      opened = true;
      router.push({ pathname: '/challenge/[id]/results', params: { id: row.id } });
    }
  }
}
