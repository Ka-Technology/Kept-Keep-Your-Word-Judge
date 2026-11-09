// Add a friend (owner, 2026-10-03; SPEC-friends.md): one person, who they are (the preview, T58) and
// Send request. Friends' search and People you may know open it, and so does someone's profile link
// or QR code (kept://add/<username>, Friends → Share my profile). The database enforces every rule
// (0009, 0035); friendRequestError() only explains a refusal before anything is sent. As in the A3
// mockup since T124 (full-set/ui-push-5-add-friend.jpg): the photo large, @username, when they joined
// and friends in common, then Add friend and Not now.

import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { ListScreen } from '@/components/list';
import { PersonPreview } from '@/components/person-preview';
import { LoadingScreen } from '@/components/step-screen';
import { useAuth } from '@/lib/auth';
import { friendErrorMessage, friendRequestError, type FoundPerson, type FriendRow } from '@/lib/friends';
import { askForNotifications } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { TEXT, useStyles, type Colors } from '@/lib/theme';
import { must, useFocusLoad } from '@/lib/use-focus-load';

export default function AddFriend() {
  const styles = useStyles(makeStyles);
  const { session } = useAuth();
  const name = (useLocalSearchParams<{ username: string }>().username ?? '').toLowerCase();
  const { data, failed, reload } = useFocusLoad(async () => {
    const [found, friends] = await Promise.all([supabase.rpc('find_user', { name }), supabase.rpc('my_friends')]);
    return { target: (must(found) as FoundPerson[])[0] ?? null, friends: must(friends) as FriendRow[] };
  }, name);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read synchronously, so a double tap can't send twice.
  const inFlight = useRef(false);

  if (!data || !session) {
    return <LoadingScreen failed={failed} onRetry={reload} message="Couldn’t load who this is. Check your connection and try again." />;
  }
  const { target, friends } = data;
  // Yourself, already friends, a request either way, or no such person (or a block, which reads the same).
  const problem = friendRequestError(target, session.user.id, friends);

  async function send(person: FoundPerson) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    const { error } = await supabase.from('friendships').insert({ addressee_id: person.id });
    inFlight.current = false;
    setSending(false);
    if (error) {
      const message = friendErrorMessage(error);
      setError(message);
      return AccessibilityInfo.announceForAccessibility(message);
    }
    setSent(true);
    AccessibilityInfo.announceForAccessibility(`Request sent to ${person.username}.`);
    // Friends' check-ins to review are now useful: iOS asks once, the first time (SPEC-notifications.md).
    askForNotifications();
  }

  return (
    <ListScreen>
      {target && <PersonPreview username={target.username} large />}
      {sent && target ? (
        <Text style={styles.sent}>Request sent to @{target.username}.</Text>
      ) : (
        target && !problem && <Button title={sending ? 'Sending…' : 'Add friend'} onPress={() => send(target)} disabled={sending} />
      )}
      <ErrorText message={sent ? null : (error ?? problem)} />
      {/* Opened from a link with Kept closed, there's nothing to go back to: then it goes Home. */}
      <Button
        title={sent || problem ? 'Done' : 'Not now'}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        variant="link"
      />
    </ListScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    sent: { ...TEXT.row, color: c.success, textAlign: 'center' },
  });
