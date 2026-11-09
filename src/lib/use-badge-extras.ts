// What a person's badges need beyond their challenges (badge_extras(), migration 0042; plan.md
// decision 27): the badges they chose to lead their profile, how many strangers' finished challenges
// they backed (Paying it forward) and how many friends' challenges they backed past Day 1 (In your
// corner). Your profile shows your own, a friend's profile theirs. Also each badge's share of Kept users
// (badge_shares()), for the Badges page and for showing the rarest first. Reloads each time the
// screen comes into view.

import { supabase } from '@/lib/supabase';
import { must, useFocusLoad } from '@/lib/use-focus-load';

export type BadgeExtras = { showcase: string[]; backed: number; supported: number };

const NONE: BadgeExtras = { showcase: [], backed: 0, supported: 0 };

/** Empty while loading, if it can't load, or when the caller isn't the person or their friend. */
export function useBadgeExtras(userId: string | undefined): BadgeExtras {
  const { data } = useFocusLoad(async () => (must(await supabase.rpc('badge_extras', { person: userId })) as BadgeExtras[])[0] ?? null, userId);
  return data ?? NONE;
}

/** How many people hold a badge, and how many use Kept. */
export type BadgeShare = { holders: number; users: number };

// One answer per app session: badge_shares() counts every user's badges, and your profile and a friend's page
// would otherwise ask on every visit (performance review, 2026-10-04). Shares move slowly.
let sessionShares: Promise<ReadonlyMap<string, BadgeShare>> | null = null;

/** Each badge's share, by id; null while loading or if it can't load (the screens then go without). */
export function useBadgeShares(): ReadonlyMap<string, BadgeShare> | null {
  return useFocusLoad(() => {
    const shares = (sessionShares ??= (async () => {
      const rows = must(await supabase.rpc('badge_shares')) as ({ badge_id: string } & BadgeShare)[];
      return new Map(rows.map((r) => [r.badge_id, { holders: r.holders, users: r.users }]));
    })());
    // A failed answer is asked again next time.
    return shares.catch((e) => {
      sessionShares = null;
      throw e;
    });
  }).data;
}
