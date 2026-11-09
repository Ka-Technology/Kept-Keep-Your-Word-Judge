// Challenges tab (owner, 2026-09-27; as in the A3 mockup since T104, full-set/sheet-tab.jpg): two
// sides, My challenges on the left and Discover on the right. My challenges leads with a wide
// "+ Start a challenge" tile (staked or a free tracker, app/challenge/new) beside a small "Past" one
// (a page of the ended ones), then the running challenges as cards with their last seven days'
// numbers under the stamps, then free trackers (owner, 2026-10-01: no money, no AI, private).
// Discover lists challenges to back, one card each (T44).

import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChallengeCard } from '@/components/challenge-card';
import { DiscoverList } from '@/components/discover-list';
import { HabitIcon } from '@/components/habit-icon';
import { ListRow, ListSection } from '@/components/list';
import { Segmented } from '@/components/segmented';
import { EmptyState, LoadingScreen } from '@/components/step-screen';
import { Tile } from '@/components/tile';
import { TabSwipe } from '@/components/tab-swipe';
import { TabTitle } from '@/components/tab-title';
import { supabase } from '@/lib/supabase';
import { FONTS, ICON, RADIUS, SCREEN, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { summarizeTracker, TRACKER_COLUMNS, trackerLine, type TrackerRow } from '@/lib/trackers';
import { must, useFocusLoad } from '@/lib/use-focus-load';
import { useMyChallenges } from '@/lib/use-my-challenges';

type Side = 'mine' | 'discover';

export default function Challenges() {
  const styles = useStyles(makeStyles);
  const c = useColors();
  const [side, setSide] = useState<Side>('mine');
  const { challenges, failed, reload } = useMyChallenges();
  const running = (challenges ?? []).filter((ch) => ch.state === 'upcoming' || ch.state === 'active');
  const pastCount = (challenges ?? []).length - running.length;
  const { data: trackers } = useFocusLoad(async () => {
    const rows = must(await supabase.from('trackers').select(TRACKER_COLUMNS).is('archived_at', null).order('created_at')) as TrackerRow[];
    const now = new Date();
    return rows.map((row) => summarizeTracker(row, now));
  });

  return (
    <TabSwipe tab="challenges">
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="automatic">
          <TabTitle title="Challenges" />
          <Segmented
            label="Show"
            options={[
              { value: 'mine', label: 'My challenges' },
              { value: 'discover', label: 'Discover' },
            ]}
            value={side}
            onChange={setSide}
          />

          {side === 'discover' ? (
            <DiscoverList />
          ) : challenges === null ? (
            <LoadingScreen inline failed={failed} onRetry={reload} message="Couldn’t load your challenges. Check your connection and try again." />
          ) : (
            <>
              <View style={styles.bento}>
                <Tile style={styles.start} onPress={() => router.push('/challenge/new')} accessibilityLabel="Start a challenge, staked or free">
                  <View style={styles.plus}>
                    <SymbolView name={{ ios: 'plus', android: 'add' }} size={ICON.row} weight="semibold" tintColor={c.text} />
                  </View>
                  <Text style={styles.startTitle}>Start a challenge</Text>
                </Tile>
                <Tile
                  style={styles.past}
                  onPress={() => router.push('/past-challenges')}
                  accessibilityLabel={`Past challenges, ${pastCount > 0 ? `${pastCount} ended` : 'none yet'}`}
                >
                  <SymbolView name={{ ios: 'clock', android: 'history' }} size={ICON.hero} tintColor={c.text} />
                  <View>
                    <Text style={styles.tileTitle}>Past</Text>
                    <Text style={styles.caption}>{pastCount > 0 ? `${pastCount} ended` : 'None yet'}</Text>
                  </View>
                </Tile>
              </View>

              <View style={styles.group}>
                <Text style={styles.heading} accessibilityRole="header">
                  Active
                </Text>
                {running.length > 0 ? (
                  running.map((ch) => <ChallengeCard key={ch.id} challenge={ch} status />)
                ) : (
                  <EmptyState
                    text={challenges.length === 0 ? 'Stake on a habit. Finish and it comes back; if not, it goes to your charity.' : 'No challenges running right now.'}
                    action="Start a challenge"
                    onPress={() => router.push('/challenge/new')}
                    variant="secondary"
                  />
                )}
              </View>

              {!!trackers?.length && (
                <ListSection title="Free trackers" footer="No money, no photos, no AI. Only you see them.">
                  {trackers.map((t, i) => (
                    <ListRow
                      key={t.id}
                      label={t.name}
                      leading={<HabitIcon look="bare" />}
                      detail={`${trackerLine(t)}${t.state === 'active' && !t.doneToday ? ' · not done today' : ''}`}
                      onPress={() => router.push({ pathname: '/tracker/[id]', params: { id: t.id } })}
                      first={i === 0}
                    />
                  ))}
                </ListSection>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </TabSwipe>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.groupedBackground },
    container: { ...SCREEN, gap: SPACE.xxl },
    bento: { flexDirection: 'row', gap: SPACE.md },
    // A wide "+ Start a challenge" tile beside a small "Past" one (A3, T104).
    start: { flex: 2, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 96 },
    plus: { width: 40, height: 40, borderRadius: RADIUS.pill, backgroundColor: c.track, alignItems: 'center', justifyContent: 'center' },
    startTitle: { ...TYPE.heading, fontFamily: FONTS.heavy, color: c.text, flex: 1 },
    past: { flex: 1, minHeight: 96, justifyContent: 'space-between' },
    tileTitle: { ...TYPE.section, color: c.text },
    caption: { ...TEXT.caption, color: c.secondaryText },
    group: { gap: SPACE.md },
    heading: { ...TYPE.title, color: c.text, marginLeft: SPACE.xs },
  });
