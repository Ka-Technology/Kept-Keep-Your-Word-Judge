// Discover, the Challenges tab's right-hand side (owner, 2026-09-27; as in the A3 mockup since T104),
// one card per challenge to back. First your friends' running challenges (read through the
// challenges table friends can see), by name, to back as a supporter; then other people's public
// challenges through discover_challenges(), only their progress and never who it is (no username or
// photo; SPEC-pledges.md decision 7, revised), to back as a backer in the first 7 days. Each opens
// its pledge screen. The server lists only public challenges still open to backers (0083, T205); the
// app drops any that have ended too, since an ending is written only when its challenger opens Kept.
// A search box over the cards narrows them by habit, charity or a friend's username (T206).

import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { Field } from '@/components/field';
import { HabitIcon } from '@/components/habit-icon';
import { ListRow, ListSection } from '@/components/list';
import { Skeleton } from '@/components/skeleton';
import { Tile } from '@/components/tile';
import { CHALLENGE_COLUMNS, shieldsLabel, summarizeChallenge, type ChallengeRow, type ChallengeSummary } from '@/lib/challenges';
import type { FriendRow } from '@/lib/friends';
import { challengeFull, KEPT_CREDITS_EXPLAINED, matchesDiscover, pledgeSummaryText, publicChallengeRow, type DiscoverRow, type PledgeSummary } from '@/lib/pledges';
import { supabase } from '@/lib/supabase';
import { bareInputStyle, ICON, PLACEHOLDER_COLOR, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { must, useFocusLoad } from '@/lib/use-focus-load';

type FriendChallenge = { friend: FriendRow; challenge: ChallengeSummary };

export function DiscoverList() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const [search, setSearch] = useState('');

  // Reloads each time the tab comes into view.
  const { data, failed, reload } = useFocusLoad(async () => {
    const [mine, pub] = await Promise.all([supabase.rpc('my_friends'), supabase.rpc('discover_challenges')]);
    const accepted = (must(mine) as FriendRow[]).filter((f) => f.status === 'accepted');
    const rows = accepted.length
      ? must(
          await supabase
            .from('challenges')
            .select(`${CHALLENGE_COLUMNS}, user_id`)
            .in('user_id', accepted.map((f) => f.user_id))
            .is('outcome', null)
            .order('created_at', { ascending: false }),
        )
      : [];
    const now = new Date();
    const friends: FriendChallenge[] = (rows as unknown as (ChallengeRow & { user_id: string })[])
      .map((row) => ({ friend: accepted.find((f) => f.user_id === row.user_id)!, challenge: summarizeChallenge(row, now) }))
      .filter(({ challenge: c }) => c.state === 'upcoming' || c.state === 'active');
    const totals = friends.length ? (must(await supabase.rpc('pledge_summaries', { ids: friends.map((f) => f.challenge.id) })) as PledgeSummary[]) : [];
    return { friends, publicRows: must(pub) as DiscoverRow[], totals };
  });

  if (!data) {
    return failed ? (
      <ListSection>
        <ListRow label="Couldn’t load challenges to back" detail="Tap to try again" onPress={reload} first />
      </ListSection>
    ) : (
      <Skeleton hero={false} />
    );
  }
  const { friends, publicRows, totals } = data;

  const pledged = (id: string) => {
    const s = totals.find((t) => t.challenge_id === id);
    return pledgeSummaryText({ totalCents: s?.total_cents ?? 0, pledgers: s?.pledgers ?? 0 });
  };
  const friendFull = (id: string) => challengeFull(totals.find((t) => t.challenge_id === id)?.total_cents ?? 0, false);
  const now = new Date();
  // A friend's public challenge shows once, as a friend's: the database leaves friends out of the public list (0027).
  const strangers = publicRows
    .map((d) => ({ d, c: summarizeChallenge(publicChallengeRow(d), now) }))
    .filter(({ c }) => c.state === 'upcoming' || c.state === 'active');
  const anything = friends.length > 0 || strangers.length > 0;
  const friendsShown = friends.filter(({ friend, challenge: c }) => matchesDiscover(search, { habit: c.title, charity: c.charityName, username: friend.username }));
  const strangersShown = strangers.filter(({ d, c }) => matchesDiscover(search, { habit: c.title, charity: d.charity }));

  return (
    <View style={styles.list}>
      <Text style={styles.intro}>
        Challenges you can back. Your friends’ show their names; public ones show their progress, never who it is.
      </Text>
      {anything && (
        <Field icon={{ ios: 'magnifyingglass', android: 'search' }}>
          <TextInput
            style={bareInputStyle(colors)}
            placeholder="Search by habit, charity or friend…"
            placeholderTextColor={PLACEHOLDER_COLOR}
            accessibilityLabel="Search challenges to back"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        </Field>
      )}
      {!anything && <Text style={styles.intro}>Nothing to back right now.</Text>}
      {anything && friendsShown.length === 0 && strangersShown.length === 0 && (
        <Text style={styles.intro} accessibilityLiveRegion="polite">
          No challenges match “{search.trim()}”.
        </Text>
      )}
      {friendsShown.map(({ friend, challenge: c }) => (
        <DiscoverCard
          key={c.id}
          challenge={c}
          username={friend.username}
          charity={c.charityName}
          pledged={pledged(c.id)}
          full={friendFull(c.id)}
          onPress={() => router.push({ pathname: '/pledge/[challengeId]', params: { challengeId: c.id, username: friend.username } })}
        />
      ))}
      {strangersShown.map(({ d, c }) => (
        <DiscoverCard
          key={d.id}
          challenge={c}
          charity={d.charity}
          pledged={pledgeSummaryText({ totalCents: d.total_cents, pledgers: d.pledgers })}
          full={challengeFull(d.total_cents, false)}
          onPress={() => router.push({ pathname: '/pledge/[challengeId]', params: { challengeId: d.id } })}
        />
      ))}
      {strangersShown.length > 0 && (
        <Text style={styles.footer}>
          Back a public challenge in its first 7 days to earn Kept credits if it finishes.{' '}
          <Text style={styles.link} accessibilityRole="link" onPress={() => Alert.alert('Kept credits', KEPT_CREDITS_EXPLAINED)}>
            What are Kept credits?
          </Text>
        </Text>
      )}
    </View>
  );
}

/**
 * One challenge to back (A3, T104): its habit, whose it is (a friend's username; a public one has
 * none), its title and day, its shields left, its charity, and "Back this challenge", or "Full" once it
 * has the $1,000 a challenge can take in pledges (decision 155).
 */
function DiscoverCard({
  challenge: c,
  username,
  charity,
  pledged,
  full,
  onPress,
}: {
  challenge: ChallengeSummary;
  username?: string;
  charity: string;
  pledged: string;
  full: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const day = c.state === 'upcoming' ? 'Starts tomorrow' : `Day ${c.today} of ${c.daysRequired}`;
  return (
    <Tile
      onPress={onPress}
      style={styles.card}
      accessibilityLabel={[username ? `${username}’s challenge` : 'A public challenge', c.title, day, shieldsLabel(c.shieldsLeft, c.shieldsTotal), `For ${charity}`, pledged, ...(full ? ['Full'] : [])].join('. ')}
      accessibilityHint="Opens it, to back it"
    >
      <View style={styles.head}>
        <HabitIcon habitId={c.habitId} look="bare" />
        <View style={styles.headText}>
          {username && <Text style={styles.username}>@{username}</Text>}
          <Text style={styles.title} numberOfLines={2}>
            {c.title}
          </Text>
          <Text style={styles.day}>{day}</Text>
        </View>
        <View style={styles.shields}>
          {Array.from({ length: c.shieldsTotal }, (_, i) => (
            <SymbolView
              key={i}
              name={i < c.shieldsLeft ? { ios: 'shield', android: 'shield' } : { ios: 'shield.slash', android: 'remove_moderator' }}
              size={ICON.row}
              tintColor={i < c.shieldsLeft ? colors.stamp : colors.secondaryText}
            />
          ))}
        </View>
      </View>
      <View style={styles.foot}>
        <View style={styles.charity}>
          <SymbolView name={{ ios: 'heart', android: 'favorite_border' }} size={ICON.inline} tintColor={colors.secondaryText} />
          <Text style={styles.charityText} numberOfLines={1}>
            {charity}
          </Text>
        </View>
        <Text style={styles.back}>{full ? 'Full' : 'Back this challenge'}</Text>
      </View>
    </Tile>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    list: { gap: SPACE.md },
    intro: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
    footer: { ...TEXT.caption, color: c.secondaryText, marginHorizontal: SPACE.sm },
    link: { color: c.link, fontWeight: '600' },
    card: { gap: SPACE.lg },
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md },
    headText: { flex: 1, gap: SPACE.xxs },
    username: { ...TEXT.caption, color: c.secondaryText },
    title: { ...TYPE.title, color: c.text },
    day: { ...TEXT.note, color: c.secondaryText },
    shields: { flexDirection: 'row', gap: SPACE.xs },
    foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md },
    charity: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, flex: 1 },
    charityText: { ...TEXT.note, color: c.secondaryText, flexShrink: 1 },
    back: { ...TEXT.note, color: c.text, fontWeight: '600' },
  });
