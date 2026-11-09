// Friend request rules on the app side (SPEC-friends.md, T22): why a request can't be sent, the
// preview's words (T58), and database errors as plain sentences. The database refuses the same things (migration 0009), so
// these only give a clearer message first. Pure: no React or Supabase imports (friends.test.ts).

/** A row of my_friends(): the other person and where the friendship stands. */
export type FriendRow = {
  friendship_id: string;
  user_id: string;
  username: string;
  avatar_path: string | null;
  status: 'pending' | 'accepted';
  /** Who asked: 'incoming' if they asked you, 'outgoing' if you asked them. */
  direction: 'incoming' | 'outgoing';
};

/** Requests waiting for the user to accept or decline: the red dot on the Friends tab. */
export function incomingRequests(friends: FriendRow[]): FriendRow[] {
  return friends.filter((f) => f.status === 'pending' && f.direction === 'incoming');
}

/** A person as find_user(), search_users() and suggested_friends() return them (0009, 0041); only suggestions count friends in common. */
export type FoundPerson = { id: string; username: string; avatar_path: string | null; mutual_count?: number };

/** Search starts after this many letters, as search_users() does (owner, 2026-10-03). */
export const SEARCH_MIN_LETTERS = 2;

/** "3 friends in common", under a person in People you may know. */
export function inCommonText(count: number): string {
  return `${count} friend${count === 1 ? '' : 's'} in common`;
}

/** Shown when find_user() finds no one. */
export const NO_SUCH_USER_MESSAGE = 'No one has that username.';

/** Why a request to `target` (find_user's answer, null for no match) can't be sent, or null if it can. */
export function friendRequestError(target: { id: string } | null, myId: string, friends: FriendRow[]): string | null {
  if (!target) return NO_SUCH_USER_MESSAGE;
  if (target.id === myId) return 'You can’t add yourself.';
  const existing = friends.find((f) => f.user_id === target.id);
  if (!existing) return null;
  if (existing.status === 'accepted') return 'You’re already friends.';
  return existing.direction === 'outgoing'
    ? 'You’ve already sent them a request.'
    : 'They’ve already sent you a request. Accept it in Friends.';
}

/** A person as person_preview() returns them (migration 0034, T58): only what the preview shows. */
export type PersonPreview = {
  id: string;
  username: string;
  avatar_path: string | null;
  /** The first day of the month they joined, YYYY-MM-01. */
  member_since: string;
  mutual_count: number;
  /** Up to 3 friends in common, by username. */
  mutual_names: string[];
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Member since September 2026", read from the date's own digits so no time zone can shift the month. */
export function memberSinceText(memberSince: string): string {
  const [year, month] = memberSince.split('-').map(Number);
  return `Member since ${MONTHS[month - 1]} ${year}`;
}

/** "2 friends in common: @ben, @cara", naming up to 3 and counting the rest ("and 4 others"). */
export function mutualFriendsText(count: number, names: string[]): string {
  if (count === 0) return 'No friends in common';
  const named = names.map((n) => `@${n}`).join(', ');
  const rest = count - names.length;
  const others = rest > 0 ? ` and ${rest} other${rest === 1 ? '' : 's'}` : '';
  return `${count} friend${count === 1 ? '' : 's'} in common: ${named}${others}`;
}

/** A plain sentence for a failed request, accept or delete (never the raw database error). */
export function friendErrorMessage(error: { code?: string; message?: string }): string {
  if (error.code === '23505') return 'There’s already a request between you. Check your Friends list.';
  if ((error.message ?? '').includes('friendships_not_self')) return 'You can’t add yourself.';
  // A block either way (T53) reads as no such user, so the person isn't told they were blocked.
  if ((error.message ?? '').includes('friendship_not_allowed')) return NO_SUCH_USER_MESSAGE;
  if (!error.code) return 'Couldn’t reach Kept. Check your connection and try again.';
  return 'Kept couldn’t do that. Please try again.';
}
