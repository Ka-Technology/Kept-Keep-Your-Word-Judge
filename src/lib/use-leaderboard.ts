// Loads the leaderboard's people (T89, plan.md decision 88): you and your friends, each with their
// staked challenges (the friends policy, 0012) and how many badges they've earned (badge_extras(),
// 0042, which answers only for you and your friends). The Friends tab passes the friends it already
// loaded. Reloads when the screen comes into view or the friends change.
// ponytail: one badge_extras call per person and every check-in of every friend; move to one
// friends_leaderboard() definer function when friend lists get large.

import { useAuth } from '@/lib/auth';
import { badgesFor } from '@/lib/badges';
import { CHALLENGE_COLUMNS, summarizeChallenge, type ChallengeRow } from '@/lib/challenges';
import type { FriendRow } from '@/lib/friends';
import type { Person } from '@/lib/leaderboard';
import { supabase } from '@/lib/supabase';
import type { BadgeExtras } from '@/lib/use-badge-extras';
import { must, useFocusLoad } from '@/lib/use-focus-load';

/** You and your accepted friends, ready for boardRows(); `people` is null while loading. */
export function useLeaderboard(friends: FriendRow[]): { people: Person[] | null; failed: boolean; reload: () => void } {
  const { session, profile } = useAuth();
  const accepted = friends.filter((f) => f.status === 'accepted');
  const everyone = session && profile
    ? [
        { id: session.user.id, username: profile.username, avatarPath: profile.avatar_path, me: true },
        ...accepted.map((f) => ({ id: f.user_id, username: f.username, avatarPath: f.avatar_path, me: false })),
      ]
    : [];
  const ids = everyone.map((p) => p.id);
  const { data, failed, reload } = useFocusLoad(async () => {
    const [rows, extras] = await Promise.all([
      supabase.from('challenges').select(`${CHALLENGE_COLUMNS}, user_id`).in('user_id', ids),
      Promise.all(ids.map((id) => supabase.rpc('badge_extras', { person: id }))),
    ]);
    const challenges = must(rows) as unknown as (ChallengeRow & { user_id: string })[];
    const now = new Date();
    return everyone.map((p, i): Person => {
      const theirs = challenges.filter((r) => r.user_id === p.id).map((r) => summarizeChallenge(r, now));
      const extra = (must(extras[i]) as BadgeExtras[])[0];
      return { ...p, challenges: theirs, badges: badgesFor(theirs, extra).length };
    });
  }, ids.length ? ids.join(',') : null);
  return { people: data, failed, reload };
}
