// How many friend requests are waiting for the user: the red dot on the Friends tab. It reloads when the screen comes into view or the app returns to the foreground, and
// at once when a request to the user arrives (Supabase Realtime, filtered to their own new requests:
// listening to every friendship change woke every phone on each unfriend; performance review, 2026-10-04).
// Friends answers a request inside its own tab, where neither of those fires, so it calls
// refreshFriendRequestCount() and the dot goes at once (owner, 2026-11-02).

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useId, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/lib/auth';
import { incomingRequests, type FriendRow } from '@/lib/friends';
import { supabase } from '@/lib/supabase';

/** Each mounted count's reload. */
const counts = new Set<() => void>();

/** Reloads every friend-request count now, after a request is accepted or declined. */
export function refreshFriendRequestCount() {
  counts.forEach((reload) => reload());
}

export function useFriendRequestCount(): number {
  const [count, setCount] = useState(0);
  // Each screen using this listens on its own channel.
  const channelName = `friend-requests-${useId()}`;
  const userId = useAuth().session?.user.id;

  const load = useCallback(() => {
    supabase.rpc('my_friends').then(({ data }) => {
      if (data) setCount(incomingRequests(data as FriendRow[]).length);
    });
  }, []);
  useFocusEffect(load);

  useEffect(() => {
    counts.add(load);
    const foreground = AppState.addEventListener('change', (state) => state === 'active' && load());
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friendships', filter: `addressee_id=eq.${userId}` }, load)
      .subscribe();
    return () => {
      counts.delete(load);
      foreground.remove();
      supabase.removeChannel(channel);
    };
  }, [channelName, load, userId]);

  return count;
}
