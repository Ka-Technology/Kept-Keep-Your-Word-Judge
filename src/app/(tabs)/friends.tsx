// The Friends tab (T88, plan.md decision 87; it was a page under Me) (T22, SPEC-friends.md; found
// like Instagram, owner 2026-10-03): search usernames as you type (those starting with what's
// typed); then, in this order (T97), requests, the leaderboard (T89), your friends, People you may
// know (friends of your friends), requests you sent, and Share my profile (a QR code and a link,
// kept://add/<username>). Someone who isn't a friend yet opens Add
// friend (add/[username].tsx) to see who it is and send a request; a friend opens their profile
// (T23). An incoming request opens a sheet with who it is (T58), Accept, Decline, Block and Report
// (T53), and a sent one can be cancelled. The database enforces every rule (0009, 0035, 0041).

import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Field } from '@/components/field';
import { Leaderboard } from '@/components/leaderboard';
import { ListRow, ListScreen, ListSection } from '@/components/list';
import { PersonPreview } from '@/components/person-preview';
import { BottomPanel } from '@/components/profile-fields';
import { ReportBlock } from '@/components/report-block';
import { TabSwipe } from '@/components/tab-swipe';
import { TabTitle } from '@/components/tab-title';
import { LoadingScreen } from '@/components/step-screen';
import { useAuth } from '@/lib/auth';
import { friendErrorMessage, inCommonText, incomingRequests, SEARCH_MIN_LETTERS, type FoundPerson, type FriendRow } from '@/lib/friends';
import { showMenu } from '@/lib/menu';
import { askForNotifications } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { bareInputStyle, PLACEHOLDER_COLOR, RADIUS, SPACE, TEXT, WHITE, useColors, useStyles, type Colors } from '@/lib/theme';
import { must, useFocusLoad } from '@/lib/use-focus-load';
import { refreshFriendRequestCount } from '@/lib/use-friend-requests';

type DbError = { code?: string; message?: string };

export default function Friends() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { profile } = useAuth();
  // Reloads each time the screen comes into view.
  const { data, failed, reload: load } = useFocusLoad(async () => {
    const [friends, suggestions] = await Promise.all([supabase.rpc('my_friends'), supabase.rpc('suggested_friends')]);
    return { friends: must(friends) as FriendRow[], suggestions: must(suggestions) as FoundPerson[] };
  });
  const [query, setQuery] = useState('');
  const typed = query.trim();
  const searching = typed.length >= SEARCH_MIN_LETTERS;
  // ponytail: one search per letter typed (the newest answer wins); add a debounce if the database feels it.
  const search = useFocusLoad(
    async () => ({ typed, people: must(await supabase.rpc('search_users', { prefix: typed })) as FoundPerson[] }),
    searching ? typed : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  // The incoming request whose sheet is open (T58). The last one stays shown while the sheet slides away.
  const [request, setRequest] = useState<FriendRow | null>(null);
  const [shownRequest, setShownRequest] = useState<FriendRow | null>(null);
  if (request && request !== shownRequest) setShownRequest(request);

  /** Accepts, declines, cancels or unfriends, then shows the lists as they are now. */
  async function change(request: PromiseLike<{ error: DbError | null }>) {
    setError(null);
    const { error } = await request;
    if (error) {
      const message = friendErrorMessage(error);
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    }
    load();
    // The tab's red dot, which doesn't reload while Friends stays in view.
    refreshFriendRequestCount();
  }
  const accept = (f: FriendRow) =>
    change(supabase.from('friendships').update({ status: 'accepted' }).eq('id', f.friendship_id)).then(askForNotifications);
  const remove = (f: FriendRow) => change(supabase.from('friendships').delete().eq('id', f.friendship_id));
  /** Closes the request's sheet and acts on the request. */
  function answer(act: (f: FriendRow) => unknown) {
    const f = request;
    setRequest(null);
    if (f) act(f);
  }

  if (!data) {
    // The tab's frame and title stay while it loads, like the other tabs.
    return (
      <TabSwipe tab="friends">
        <SafeAreaView style={styles.safe} edges={['top']}>
          <ListScreen>
            <TabTitle title="Friends" />
            <LoadingScreen inline failed={failed} onRetry={load} message="Couldn’t load your friends. Check your connection and try again." />
          </ListScreen>
        </SafeAreaView>
      </TabSwipe>
    );
  }

  const { friends, suggestions } = data;
  const incoming = incomingRequests(friends);
  const outgoing = friends.filter((f) => f.status === 'pending' && f.direction === 'outgoing');
  const accepted = friends.filter((f) => f.status === 'accepted');
  // Only this search's answer: the last one never shows under new letters.
  const results = search.data?.typed === typed ? search.data.people : null;

  /** Where you stand with someone in the search results, if anywhere. */
  function standing(id: string): string | undefined {
    const f = friends.find((f) => f.user_id === id);
    if (!f) return undefined;
    if (f.status === 'accepted') return 'Friend';
    return f.direction === 'outgoing' ? 'Requested' : 'Wants to be your friend';
  }
  /** A friend opens their profile; anyone else, Add friend. */
  function openPerson(p: FoundPerson) {
    if (accepted.some((f) => f.user_id === p.id)) router.push({ pathname: '/friend/[id]', params: { id: p.id } });
    else router.push({ pathname: '/add/[username]', params: { username: p.username } });
  }

  // Works in a development build too (Linking.createURL picks the build's own scheme).
  const link = profile ? Linking.createURL(`add/${encodeURIComponent(profile.username)}`) : '';

  return (
    <TabSwipe tab="friends">
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ListScreen>
          <TabTitle title="Friends" />
          <Field icon={{ ios: 'magnifyingglass', android: 'search' }} error={error}>
            <TextInput
              style={bareInputStyle(colors)}
              placeholder="Find friends by username"
              placeholderTextColor={PLACEHOLDER_COLOR}
              accessibilityLabel="Find friends by username"
              value={query}
              onChangeText={(text) => setQuery(text.toLowerCase())}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </Field>

          {searching ? (
            search.failed ? (
              <Button title="Couldn’t search. Try again" onPress={search.reload} variant="secondary" />
            ) : !results ? (
              <Text style={styles.empty}>Searching…</Text>
            ) : results.length === 0 ? (
              <Text style={styles.empty}>No username starts with “{typed}”.</Text>
            ) : (
              <People title="Results" people={results} keyOf={(p) => p.id} detail={(p) => standing(p.id)} onPress={openPerson} />
            )
          ) : (
            <>
              {incoming.length > 0 && (
                <ListSection title="Requests" titleInside footer="Tap a name to see who it is first, or to report or block them.">
                  {incoming.map((f, i) => (
                    <View key={f.friendship_id} style={[styles.request, i > 0 && styles.divider]}>
                      <Pressable
                        style={styles.requestWho}
                        onPress={() => setRequest(f)}
                        accessibilityRole="button"
                        accessibilityLabel={`${f.username} wants to be friends`}
                        accessibilityHint="Shows who it is"
                      >
                        <Avatar path={f.avatar_path} username={f.username} size={44} />
                        <View style={styles.requestText}>
                          <Text style={styles.requestName} numberOfLines={1}>
                            @{f.username}
                          </Text>
                          <Text style={styles.requestNote}>wants to be friends</Text>
                        </View>
                      </Pressable>
                      <Button title="Accept" onPress={() => accept(f)} compact />
                      <Button title="Decline" onPress={() => remove(f)} variant="destructiveLink" />
                    </View>
                  ))}
                </ListSection>
              )}
              <Leaderboard friends={friends} onShare={() => setSharing(true)} />
              {accepted.length > 0 && (
                <ListSection title="Your friends" titleInside footer="Tap a friend to see their challenges.">
                  {accepted.map((f, i) => (
                    <ListRow
                      key={f.friendship_id}
                      leading={<Avatar path={f.avatar_path} username={f.username} size={40} />}
                      label={f.username}
                      detail="Friend"
                      onPress={() => router.push({ pathname: '/friend/[id]', params: { id: f.user_id } })}
                      first={i === 0}
                    />
                  ))}
                </ListSection>
              )}
              <People
                title="People you may know"
                footer="Friends of your friends."
                people={suggestions}
                keyOf={(p) => p.id}
                detail={(p) => inCommonText(p.mutual_count ?? 0)}
                onPress={openPerson}
              />
              <People
                title="Sent"
                footer="Waiting for them to accept."
                people={outgoing}
                keyOf={(f) => f.friendship_id}
                onPress={(f) => showMenu(`Your request to ${f.username}`, [{ label: 'Cancel request', run: () => remove(f), destructive: true }])}
              />
              <ListSection>
                <ListRow label="Share my profile" icon={{ ios: 'qrcode', android: 'qr_code' }} onPress={() => setSharing(true)} first />
              </ListSection>
            </>
          )}

          <BottomPanel visible={request !== null} title="Friend request" buttonTitle="Close" onClose={() => setRequest(null)}>
            {shownRequest && (
              <View style={styles.sheet}>
                <PersonPreview username={shownRequest.username} />
                <Button title="Accept" onPress={() => answer(accept)} />
                <Button title="Decline" onPress={() => answer(remove)} variant="destructiveLink" />
                <ReportBlock
                  report={{ reportedId: shownRequest.user_id }}
                  block={{ user: shownRequest.user_id }}
                  name={`@${shownRequest.username}`}
                  onReport={() => setRequest(null)}
                  onBlocked={() => {
                    setRequest(null);
                    load();
                  }}
                />
              </View>
            )}
          </BottomPanel>

          <BottomPanel visible={sharing} title="Share my profile" buttonTitle="Close" onClose={() => setSharing(false)}>
            <View style={styles.sheet}>
              {/* Black on white whatever the theme, so every camera reads it. */}
              <View style={styles.qr} accessible accessibilityLabel={`QR code for your profile, @${profile?.username}`}>
                <QRCode value={link} size={200} />
              </View>
              <Text style={styles.note}>
                Friends scan this with their phone’s camera to open your profile in Kept, then send you a request. The link works for friends
                who have Kept.
              </Text>
              <Button title="Share link" onPress={() => Share.share({ message: `Add me on Kept: ${link}` }).catch(() => undefined)} variant="secondary" />
            </View>
          </BottomPanel>
        </ListScreen>
      </SafeAreaView>
    </TabSwipe>
  );
}

/** A titled list of people with their photos. Renders nothing when there's no one. */
function People<T extends { username: string; avatar_path: string | null }>({
  title,
  footer,
  people,
  keyOf,
  detail,
  onPress,
}: {
  title: string;
  footer?: string;
  people: T[];
  keyOf: (p: T) => string;
  /** A second line, e.g. "2 friends in common". */
  detail?: (p: T) => string | undefined;
  onPress: (p: T) => void;
}) {
  if (people.length === 0) return null;
  return (
    <ListSection title={title} footer={footer}>
      {people.map((p, i) => (
        <ListRow
          key={keyOf(p)}
          leading={<Avatar path={p.avatar_path} username={p.username} size={32} />}
          label={p.username}
          detail={detail?.(p)}
          onPress={() => onPress(p)}
          first={i === 0}
        />
      ))}
    </ListSection>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.groupedBackground },
    request: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator },
    requestWho: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    requestText: { flex: 1 },
    requestName: { ...TEXT.row, fontWeight: '600', color: c.text },
    requestNote: { ...TEXT.caption, color: c.secondaryText },
    empty: { ...TEXT.body, color: c.secondaryText, marginHorizontal: SPACE.xs },
    sheet: { gap: SPACE.md, padding: SPACE.lg },
    qr: { alignSelf: 'center', padding: SPACE.md, borderRadius: RADIUS.card, backgroundColor: WHITE },
    note: { ...TEXT.note, color: c.secondaryText, textAlign: 'center' },
  });
