// Friends' check-ins waiting for this user's review (T26): the Check in tab's "Needs your review" and
// the review screen. The database decides which ones (check_ins_to_review(): pending, from a friend
// since before the challenge's Day 1 whom this user has pledged behind, T60); my_friends() adds each
// challenger's username and photo.
// Reloads each time the screen comes into view.

import type { FriendRow } from '@/lib/friends';
import { supabase } from '@/lib/supabase';
import { must, useFocusLoad } from '@/lib/use-focus-load';

export type Review = {
  check_in_id: string;
  challenger_id: string;
  habit_name: string;
  check_summary: string;
  day: number;
  photo_path: string | null;
  photo_taken_at: string | null;
  book: string | null;
  pages: string | null;
  time_zone: string;
  username: string;
  avatar_path: string | null;
};

/** `reviews` is null until the first load; `failed` offers a retry through `reload`. */
export function useReviews(): { reviews: Review[] | null; failed: boolean; reload: () => void } {
  const { data, failed, reload } = useFocusLoad(async () => {
    const [waiting, friends] = await Promise.all([supabase.rpc('check_ins_to_review'), supabase.rpc('my_friends')]);
    const people = new Map((must(friends) as FriendRow[]).map((f) => [f.user_id, f]));
    return (must(waiting) as Omit<Review, 'username' | 'avatar_path'>[]).map((r) => ({
      ...r,
      username: people.get(r.challenger_id)?.username ?? 'a friend',
      avatar_path: people.get(r.challenger_id)?.avatar_path ?? null,
    }));
  });
  return { reviews: data, failed, reload };
}
