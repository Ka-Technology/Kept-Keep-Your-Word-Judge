// Check in tab (owner interview, 2026-09-27; as in the A3 mockup since T105, full-set/sheet-tab.jpg
// "check in" and "check in empty"): today's jobs, each one tap from done. Your check-ins still due
// are cards ("Due today", the habit, "Due by 11:59 PM" and the real time left before midnight in the
// challenge's zone) with a green Check in pill; one tap opens that habit's own check (the camera
// straight away where that's the only way). A check-in that didn't pass comes back with a red edge
// (owner, 2026-10-02): to redo, among what's due, or to appeal once it wasn't approved. Friends'
// check-ins waiting for you are one "Review for friends" card, never red: the AI checks them if
// nobody does. Once everything's in, the K stamp; with nothing to check in, the K box and a way to
// start. What you've checked in today sits quietly at the end.

import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionCard } from '@/components/action-card';
import { Avatar } from '@/components/avatar';
import { BigStamp, DayStamp } from '@/components/big-stamp';
import { Button } from '@/components/button';
import { PhotoThumb } from '@/components/check-in-photo';
import { ListRow, ListSection } from '@/components/list';
import { LoadingScreen } from '@/components/step-screen';
import { Tile } from '@/components/tile';
import { TabSwipe } from '@/components/tab-swipe';
import { TabTitle } from '@/components/tab-title';
import { ICON, SCREEN, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { dueSoonest, recentStamps, timeLeft, todayAction } from '@/lib/today';
import { useMyChallenges } from '@/lib/use-my-challenges';
import { useNow } from '@/lib/use-now';
import { useReviews } from '@/lib/use-reviews';

export default function CheckIn() {
  const styles = useStyles(makeStyles);
  const c = useColors();
  const now = useNow();
  const { challenges, failed, reload } = useMyChallenges();
  const { reviews } = useReviews();
  const active = (challenges ?? []).filter((ch) => ch.state === 'active');
  const due = dueSoonest(active, now);
  const appeals = active.filter((ch) => todayAction(ch) === 'appeal');
  const done = active.filter((ch) => ch.checkedInToday && todayAction(ch) === null);
  const upcoming = (challenges ?? []).filter((ch) => ch.state === 'upcoming');

  return (
    <TabSwipe tab="check-in">
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="automatic">
          <TabTitle title="Check in" />

          {challenges === null ? (
            <LoadingScreen inline failed={failed} onRetry={reload} message="Couldn’t load your challenges. Check your connection and try again." />
          ) : (
            <>
              {due.map(({ challenge: ch, minutes, action }) =>
                action === 'redo' ? (
                  // A friend or Kept's AI asked for it again: the check-in screen opens on what went wrong.
                  <ActionCard
                    key={ch.id}
                    tone="failed"
                    label="Do it again"
                    title={`${ch.title}, Day ${ch.today}`}
                    line={`${ch.todayText ?? 'Asked for a new check-in'}. ${timeLeft(minutes)}.`}
                    action="Redo"
                    onPress={() => router.push({ pathname: '/check-in/[challengeId]', params: { challengeId: ch.id } })}
                  />
                ) : (
                  <ActionCard
                    key={ch.id}
                    tone="due"
                    label="Due today"
                    title={ch.title}
                    line={`Due by 11:59 PM, ${timeLeft(minutes)}`}
                    action="Check in"
                    onPress={() => router.push({ pathname: '/check-in/[challengeId]', params: { challengeId: ch.id, day: String(ch.today), start: '1' } })}
                  />
                ),
              )}
              {appeals.map((ch) => (
                <ActionCard
                  key={ch.id}
                  tone="failed"
                  label="Not approved"
                  title={`${ch.title}, Day ${ch.today}`}
                  line="You can appeal it within 7 days."
                  action="Appeal"
                  onPress={() => router.push({ pathname: '/check-in/[challengeId]', params: { challengeId: ch.id } })}
                />
              ))}
              {due.length === 0 &&
                appeals.length === 0 &&
                (active.length > 0 ? (
                  <Tile style={styles.center}>
                    <BigStamp color={c.stamp} size={96} centered />
                    <Text style={styles.centerTitle}>All kept today</Text>
                    <Text style={styles.centerBody}>You’re all checked in. Come back tomorrow.</Text>
                  </Tile>
                ) : (
                  <Tile style={styles.center}>
                    <DayStamp kind="kept" color={c.stamp} size={96} />
                    <Text style={styles.centerTitle}>{upcoming.length > 0 ? 'Nothing to check in yet.' : 'Nothing to check in today.'}</Text>
                    <Text style={styles.centerBody}>
                      {upcoming.length > 0 ? 'Your challenges start soon.' : 'Start a challenge and your daily check-in shows up here.'}
                    </Text>
                    {upcoming.length > 0 ? (
                      <Button title="See your challenges" onPress={() => router.navigate('/challenges')} compact />
                    ) : (
                      <Button title="Start a challenge" onPress={() => router.push('/challenge/new')} compact />
                    )}
                  </Tile>
                ))}
            </>
          )}

          {!!reviews?.length && (
            <ListSection title="Review for friends" titleInside>
              {reviews.map((r, i) => (
                <ListRow
                  key={r.check_in_id}
                  leading={r.photo_path ? <PhotoThumb path={r.photo_path} /> : <Avatar path={r.avatar_path} username={r.username} size={56} />}
                  label={`@${r.username}, ${r.habit_name}, Day ${r.day}`}
                  detail="Approve it, or ask for a new photo"
                  onPress={() => router.push({ pathname: '/review/[checkInId]', params: { checkInId: r.check_in_id } })}
                  first={i === 0}
                />
              ))}
            </ListSection>
          )}

          {done.length > 0 && (
            <ListSection title="Checked in today" titleInside>
              {done.map((ch, i) => {
                const kept = recentStamps(ch).at(-1)?.kind === 'kept';
                return (
                  <ListRow
                    key={ch.id}
                    leading={
                      kept ? (
                        <DayStamp kind="kept" color={c.stamp} size={36} />
                      ) : (
                        <SymbolView name={{ ios: 'hourglass', android: 'hourglass_empty' }} size={ICON.row} tintColor={c.secondaryText} />
                      )
                    }
                    label={ch.title}
                    detail={kept ? undefined : (ch.todayText ?? undefined)}
                    onPress={() => router.push({ pathname: '/check-in/[challengeId]', params: { challengeId: ch.id } })}
                    first={i === 0}
                  />
                );
              })}
            </ListSection>
          )}
        </ScrollView>
      </SafeAreaView>
    </TabSwipe>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.groupedBackground },
    container: { ...SCREEN, gap: SPACE.lg },
    center: { alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.xxxl, paddingHorizontal: SPACE.xl },
    centerTitle: { ...TYPE.title, color: c.text, textAlign: 'center' },
    centerBody: { ...TEXT.body, color: c.secondaryText, textAlign: 'center', marginBottom: SPACE.sm },
  });
