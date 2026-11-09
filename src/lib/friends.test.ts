// Unit tests for friends.ts: why a friend request can't be sent, and database errors as sentences.
import { friendErrorMessage, friendRequestError, incomingRequests, inCommonText, memberSinceText, mutualFriendsText, NO_SUCH_USER_MESSAGE, type FriendRow } from './friends';

describe('a request refused by a block (T53)', () => {
  it('reads as if the username doesn’t exist, so the person isn’t told', () => {
    expect(friendErrorMessage({ code: 'P0001', message: 'friendship_not_allowed' })).toBe(NO_SUCH_USER_MESSAGE);
  });
});

describe('the preview before a request (T58)', () => {
  it('says the month and year they joined, from person_preview()’s first-of-the-month date', () => {
    expect(memberSinceText('2026-09-01')).toBe('Member since September 2026');
    expect(memberSinceText('2025-12-01')).toBe('Member since December 2025');
  });

  it('names up to 3 friends in common, then counts the rest', () => {
    expect(mutualFriendsText(0, [])).toBe('No friends in common');
    expect(mutualFriendsText(1, ['ben'])).toBe('1 friend in common: @ben');
    expect(mutualFriendsText(2, ['ben', 'cara'])).toBe('2 friends in common: @ben, @cara');
    expect(mutualFriendsText(3, ['ben', 'cara', 'dev'])).toBe('3 friends in common: @ben, @cara, @dev');
    expect(mutualFriendsText(4, ['ben', 'cara', 'dev'])).toBe('4 friends in common: @ben, @cara, @dev and 1 other');
    expect(mutualFriendsText(7, ['ben', 'cara', 'dev'])).toBe('7 friends in common: @ben, @cara, @dev and 4 others');
  });
});

const me = 'user-me';
const row = (user_id: string, status: FriendRow['status'], direction: FriendRow['direction']): FriendRow => ({
  friendship_id: `f-${user_id}`,
  user_id,
  username: user_id,
  avatar_path: null,
  status,
  direction,
});

describe('People you may know (owner, 2026-10-03)', () => {
  it('counts friends in common, singular and plural', () => {
    expect(inCommonText(1)).toBe('1 friend in common');
    expect(inCommonText(4)).toBe('4 friends in common');
  });
});

describe('friendRequestError (SPEC-friends.md’s plain sentences)', () => {
  it('allows a request to someone new', () => {
    expect(friendRequestError({ id: 'user-b' }, me, [row('user-c', 'accepted', 'outgoing')])).toBeNull();
  });

  it('says so when no one has the username', () => {
    expect(friendRequestError(null, me, [])).toBe('No one has that username.');
  });

  it('refuses yourself', () => {
    expect(friendRequestError({ id: me }, me, [])).toBe('You can’t add yourself.');
  });

  it('refuses a second request you sent', () => {
    expect(friendRequestError({ id: 'user-b' }, me, [row('user-b', 'pending', 'outgoing')])).toBe('You’ve already sent them a request.');
  });

  it('points to their request when they asked first', () => {
    expect(friendRequestError({ id: 'user-b' }, me, [row('user-b', 'pending', 'incoming')])).toBe(
      'They’ve already sent you a request. Accept it in Friends.',
    );
  });

  it('refuses someone who is already a friend', () => {
    expect(friendRequestError({ id: 'user-b' }, me, [row('user-b', 'accepted', 'incoming')])).toBe('You’re already friends.');
  });
});

describe('friendErrorMessage', () => {
  it('explains a request the database refused as a duplicate', () => {
    expect(friendErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "friendships_pair"' })).toBe(
      'There’s already a request between you. Check your Friends list.',
    );
  });

  it('explains a request to yourself', () => {
    expect(friendErrorMessage({ code: '23514', message: 'new row violates check constraint "friendships_not_self"' })).toBe(
      'You can’t add yourself.',
    );
  });

  it('blames the connection when there is no answer', () => {
    expect(friendErrorMessage({})).toBe('Couldn’t reach Kept. Check your connection and try again.');
  });

  it('falls back to a plain sentence', () => {
    expect(friendErrorMessage({ code: '42501', message: 'permission denied' })).toBe('Kept couldn’t do that. Please try again.');
  });
});

describe('incomingRequests (the red dot on the Friends tab)', () => {
  it('counts only requests waiting for you, not ones you sent or friends', () => {
    const rows = [row('b', 'pending', 'incoming'), row('c', 'pending', 'outgoing'), row('d', 'accepted', 'incoming'), row('e', 'pending', 'incoming')];
    expect(incomingRequests(rows).map((f) => f.user_id)).toEqual(['b', 'e']);
  });
});
