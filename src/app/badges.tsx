// Profile → Badges (owner, 2026-10-02; decision 27's Badges page, the brand canvas's "Badges in the
// app"): every badge, earned or not, in three groups (keeping; falling and getting up; giving) and a
// fourth of secret ones, the hard ones, which show only that they exist and how rare until they're
// earned (owner, 2026-10-03). Each row has what earns it, the day once earned, and its share of Kept
// users (badge_shares(), like Steam's achievements); locked counted badges say how close they are.
// Tapping a badge you have puts it on your profile, up to three (the showcase); until you pick, your
// rarest show, and the top of the page says so. Badges come only from staked challenges and pledges
// (lib/badges.ts), never free trackers. As in the A3 mockup since T122 (full-set/ui-push-3-badges.jpg):
// "Badges" and "N of 27 earned" beside a rosette, then three to a row as tiles, locked ones grey with a
// lock; tapping one says what earns it, and one you have can go on or come off your profile there.
// Opened from a friend's page (`friend` and `username`, T210), it shows that friend's badges the same way,
// read through what friends may already read (their challenges, 0012; badge_extras(), 0042), without the
// choosing.

import { useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { BadgeSeal } from '@/components/badge';
import { ListScreen } from '@/components/list';
import { LoadingScreen } from '@/components/step-screen';
import { PageTitle } from '@/components/tab-title';
import { Tile } from '@/components/tile';
import { useAuth } from '@/lib/auth';
import { BADGE_BY_ID, badgeProgress, badgesFor, BADGES, canChooseMore, shareText, SHOWCASE_MAX, toggleShowcase, type BadgeId } from '@/lib/badges';
import { CHALLENGE_COLUMNS, summarizeChallenge, type ChallengeRow } from '@/lib/challenges';
import { fromDateString } from '@/lib/profile';
import { backerBadgeText } from '@/lib/pledges';
import { supabase } from '@/lib/supabase';
import { ICON, RADIUS, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { useBadgeExtras, useBadgeShares } from '@/lib/use-badge-extras';
import { must, useFocusLoad } from '@/lib/use-focus-load';
import { useMyChallenges } from '@/lib/use-my-challenges';

const GROUPS: { title: string; ids: BadgeId[] }[] = [
  { title: 'Keeping', ids: BADGES.filter((b) => b.tone === 'kept' && !b.secret).map((b) => b.id) },
  { title: 'Falling and getting up', ids: BADGES.filter((b) => b.tone === 'fall' && !b.secret).map((b) => b.id) },
  { title: 'Giving', ids: BADGES.filter((b) => b.tone === 'give' && !b.secret).map((b) => b.id) },
  { title: 'Secret', ids: BADGES.filter((b) => b.secret).map((b) => b.id) },
];

export default function Badges() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { session, profile, updateProfile } = useAuth();
  // A friend's id and username when opened from their page; neither for your own.
  const { friend, username } = useLocalSearchParams<{ friend?: string; username?: string }>();
  const mine = useMyChallenges();
  // A friend's challenges, as their page reads them; waits (null key) on your own page.
  const theirs = useFocusLoad(async () => {
    const rows = must(await supabase.from('challenges').select(CHALLENGE_COLUMNS).eq('user_id', friend!).order('created_at', { ascending: false }));
    const now = new Date();
    return (rows as unknown as ChallengeRow[]).map((row) => summarizeChallenge(row, now));
  }, friend ?? null);
  const { challenges, failed, reload } = friend ? { challenges: theirs.data, failed: theirs.failed, reload: theirs.reload } : mine;
  const extras = useBadgeExtras(friend ?? session?.user.id);
  const shares = useBadgeShares();
  // Read synchronously, so a quick second tap can't overwrite the first save.
  const saving = useRef(false);
  if (!challenges) {
    return <LoadingScreen failed={failed} onRetry={reload} message={`Couldn’t load ${friend ? 'these' : 'your'} badges. Check your connection and try again.`} />;
  }

  const earnedList = badgesFor(challenges, extras);
  const earned = new Map(earnedList.map((b) => [b.id, b]));
  const progress = badgeProgress(challenges);
  const showcase = friend ? extras.showcase : (profile?.showcase_badges ?? []);
  const when = (on: string | null) => (on ? fromDateString(on).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null);
  const share = (id: BadgeId) => {
    const s = shares?.get(id);
    return s ? shareText(s.holders, s.users) : null;
  };

  async function toggle(id: BadgeId) {
    if (saving.current) return;
    // A chosen badge no longer earned (a revived challenge's First fall) frees its place.
    const next = toggleShowcase(showcase.filter((x) => earned.has(x as BadgeId)), id);
    if (next === 'full') return Alert.alert(`Your profile shows ${SHOWCASE_MAX}`, 'Take one that’s showing off first.');
    saving.current = true;
    const result = await updateProfile({ showcase_badges: next });
    saving.current = false;
    if (result !== 'saved') Alert.alert('Couldn’t save', 'Check your connection and try again.');
  }

  /** What a badge says about itself: what earns it, when it was earned or how close, how rare. */
  function detailOf(id: BadgeId): string {
    const b = BADGE_BY_ID.get(id)!;
    const got = earned.get(id);
    const hidden = b.secret && !got;
    return [
      hidden ? 'A hard one. Keep your word to find out what it takes.' : id === 'paying-it-forward' && got ? backerBadgeText(extras.backed) : b.how,
      got ? `Earned ${when(got.earnedOn)}` : hidden ? null : progress[id],
      share(id),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  /** Tapping a badge opens what it is; one you have can go on (or come off) your profile from there. */
  function open(id: BadgeId) {
    const b = BADGE_BY_ID.get(id)!;
    const got = earned.has(id);
    const name = b.secret && !got ? 'Secret badge' : b.name;
    // A friend's badges are theirs to choose.
    if (!got || friend) return Alert.alert(name, detailOf(id));
    const showing = showcase.includes(id);
    Alert.alert(name, detailOf(id), [
      { text: 'Close', style: 'cancel' },
      { text: showing ? 'Take off my profile' : 'Show on my profile', onPress: () => toggle(id) },
    ]);
  }

  return (
    <ListScreen>
      <PageTitle
        title={friend ? `@${username}’s badges` : 'Badges'}
        subtitle={`${earned.size} of ${BADGES.length} earned`}
        icon={
          <View style={styles.headIcon}>
            <SymbolView name={{ ios: 'rosette', android: 'military_tech' }} size={ICON.hero} tintColor={colors.text} />
          </View>
        }
      />
      {!friend && canChooseMore(earnedList, showcase) && (
        <View style={styles.invite} accessible accessibilityRole="text">
          <Text style={styles.inviteTitle}>Choose the three on your profile</Text>
          <Text style={styles.inviteBody}>Tap a badge you have to show it. Until you pick, your rarest show.</Text>
        </View>
      )}
      {GROUPS.map((g) => (
        <View key={g.title} style={styles.group}>
          <Text style={styles.groupTitle} accessibilityRole="header">
            {g.title}
          </Text>
          <View style={styles.grid}>
            {g.ids.map((id) => {
              const b = BADGE_BY_ID.get(id)!;
              const got = earned.get(id);
              const name = b.secret && !got ? 'Secret badge' : b.name;
              const onProfile = !!got && showcase.includes(id);
              return (
                <Tile
                  key={id}
                  style={styles.tile}
                  onPress={() => open(id)}
                  accessibilityLabel={[name, got ? `earned ${when(got.earnedOn)}` : 'not earned yet', onProfile ? (friend ? 'on their profile' : 'on your profile') : null]
                    .filter(Boolean)
                    .join(', ')}
                  accessibilityHint="Shows what earns it"
                >
                  <View>
                    <BadgeSeal id={id} earned={!!got} size={64} />
                    {!got && (
                      <View style={styles.lock}>
                        <SymbolView name={{ ios: 'lock.fill', android: 'lock' }} size={12} tintColor={colors.secondaryText} />
                      </View>
                    )}
                  </View>
                  <Text style={got ? styles.name : styles.lockedName} numberOfLines={2}>
                    {name}
                  </Text>
                  {onProfile && (
                    <View style={styles.showing}>
                      <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle' }} size={ICON.inline} tintColor={colors.stamp} />
                    </View>
                  )}
                </Tile>
              );
            })}
          </View>
        </View>
      ))}
      <Text style={styles.intro}>
        {friend
          ? 'Badges come only from staked challenges and pledges, never free trackers. The ones they chose come first on their page.'
          : 'Badges come only from staked challenges and pledges, never free trackers. Your friends see the ones you show first, then the rest.'}
      </Text>
    </ListScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    headIcon: {
      width: 60,
      height: 60,
      borderRadius: RADIUS.field,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.card,
      boxShadow: c.tileShadow || undefined,
    },
    intro: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
    invite: { gap: SPACE.xs, padding: SPACE.lg, borderRadius: RADIUS.tile, borderCurve: 'continuous', backgroundColor: c.selected },
    inviteTitle: { ...TEXT.row, color: c.link, fontWeight: '600' },
    inviteBody: { ...TEXT.note, color: c.text },
    group: { gap: SPACE.sm },
    groupTitle: { ...TYPE.section, color: c.text, marginLeft: SPACE.xs },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
    // Three to a row: a third of the width, less the gaps.
    tile: {
      width: '31.5%',
      alignItems: 'center',
      gap: SPACE.sm,
      paddingVertical: SPACE.lg,
      paddingHorizontal: SPACE.xs,
    },
    lock: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.separator,
    },
    name: { ...TEXT.note, color: c.text, fontWeight: '700', textAlign: 'center' },
    lockedName: { ...TEXT.note, color: c.secondaryText, textAlign: 'center' },
    showing: { position: 'absolute', top: SPACE.sm, right: SPACE.sm },
  });
