// First-run tutorial (SPEC-app-shell.md): five cards that explain how Kept works, then the one
// permission primer (T97): what notifications are for, before iOS asks. Home opens it once per
// user; Settings → How Kept works opens it again. Turn on notifications shows iOS's prompt (the
// first time only) and closes it; Not now just closes it. Skip jumps ahead to that last card, so skipping
// the tutorial still asks about notifications (owner, 2026-10-26). Either way it's marked seen. As in
// the A3 mockup since T141 (full-set/ui-flow-8-tutorial.jpg): each card's art (docs/design/art's tut-1
// to tut-5) in a card, its title and words in a card under it, the dots and Next; the primer keeps its bell.

import { Image, type ImageSource } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Tile } from '@/components/tile';
import { useAuth } from '@/lib/auth';
import { askForNotifications } from '@/lib/notifications';
import { COLUMN, RADIUS, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { markTutorialSeen } from '@/lib/tutorial';

/** The cards, in order, each with its art (or the primer's bell). Wording follows SPEC.md's challenge and money rules. */
const CARDS: { art?: ImageSource; icon?: SymbolViewProps['name']; title: string; body: string }[] = [
  {
    art: require('@/assets/images/tutorial/tut-1-welcome.jpg'),
    title: 'Welcome to Kept',
    body: 'Change a habit for the better, and give to charity while you do it.',
  },
  {
    art: require('@/assets/images/tutorial/tut-2-start.jpg'),
    title: 'Start your own challenge',
    body: 'Pick a habit, how long to keep it (28 days by default), how much to stake, and a charity: one of Kept’s choices, or any US nonprofit you find through Every.org.',
  },
  {
    art: require('@/assets/images/tutorial/tut-3-check-in.jpg'),
    title: 'Check in every day',
    body: 'Show you did the day’s habit. Friends who back your challenge confirm it, and if nobody does before the deadline, Kept’s AI takes a look, if you allow it.',
  },
  {
    art: require('@/assets/images/tutorial/tut-4-shields.jpg'),
    title: 'You have 2 shields',
    body: 'Miss a day and a shield breaks, and a day is added to the end. Miss a day with none left and the challenge ends unfinished.',
  },
  {
    art: require('@/assets/images/tutorial/tut-5-money.jpg'),
    title: 'Where the money goes',
    body: 'Finish and your stake comes back, and the pledges behind you are your reward. If you don’t, your stake goes to your charity and supporters get their pledges back. No one wins your stake: it goes to your charity.',
  },
  // The permission primer: the only place Kept asks for notifications on its own.
  {
    icon: { ios: 'bell.badge.fill', android: 'notifications_active' },
    title: 'A nudge before a miss',
    body: 'Kept can remind you at 8 pm on a day you haven’t checked in, and tell you when a friend’s check-in needs you. Change it any time in Settings.',
  },
];

export default function Tutorial() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { session } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const scroller = useRef<ScrollViewInstance>(null);
  const last = index === CARDS.length - 1;

  /**
   * Closes the tutorial (back to Home or Settings) and remembers it was seen. With `notify` (the
   * primer's button), iOS asks whether Kept may send notifications, now that the user knows what
   * they're for; after that first time (a replay from Settings) nothing is asked.
   */
  function finish(notify = false) {
    if (session) markTutorialSeen(session.user.id);
    router.back();
    if (notify) askForNotifications();
  }

  /** Moves to a card; VoiceOver reads its title. */
  function goTo(cardIndex: number) {
    scroller.current?.scrollTo({ x: width * cardIndex, animated: true });
    setIndex(cardIndex);
    AccessibilityInfo.announceForAccessibility(`Step ${cardIndex + 1} of ${CARDS.length}. ${CARDS[cardIndex].title}`);
  }

  /** Moves to the next card, or finishes on the last one. */
  function next() {
    if (last) return finish(true);
    goTo(index + 1);
  }

  return (
    // The insets come from the app's root, not a SafeAreaView: this screen slides up, SafeAreaView would
    // measure itself mid-slide, off screen, get no top inset, and Skip would land under the status bar.
    <View style={[styles.safe, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <View style={styles.top}>
        {/* Skip leads to the notification card, which asks; on that card there's nothing left to skip. */}
        {!last && <Button title="Skip" onPress={() => goTo(CARDS.length - 1)} variant="link" />}
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        // The window's width changed (an iPad turned, a Split View resized): stay on the same card.
        onContentSizeChange={() => scroller.current?.scrollTo({ x: width * index, animated: false })}
      >
        {CARDS.map((card, i) => (
          // Each card scrolls up and down by itself, so its text still fits at the largest text sizes.
          <ScrollView key={card.title} style={{ width }} contentContainerStyle={styles.card}>
            <View
              style={styles.cardContent}
              accessible
              accessibilityLabel={`Step ${i + 1} of ${CARDS.length}. ${card.title}. ${card.body}`}
            >
              {card.art ? (
                <View style={styles.artCard}>
                  <Image source={card.art} style={styles.art} contentFit="cover" accessible={false} />
                </View>
              ) : (
                card.icon && (
                  <View style={styles.iconTile}>
                    <SymbolView name={card.icon} size={64} tintColor={colors.link} />
                  </View>
                )
              )}
              <Tile style={styles.textCard}>
                <Text style={styles.title}>{card.title}</Text>
                <Text style={styles.body}>{card.body}</Text>
              </Tile>
            </View>
          </ScrollView>
        ))}
      </ScrollView>

      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {CARDS.map((card, i) => (
          <View key={card.title} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>
      <View style={styles.bottom}>
        <Button title={last ? 'Turn on notifications' : 'Next'} onPress={next} />
        {last && <Button title="Not now" onPress={() => finish()} variant="link" />}
      </View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1 },
    // Skip and Next keep clear of the screen's edges, where iOS's own swipes (Control Center, Home) take the taps.
    top: { alignItems: 'flex-end', paddingHorizontal: SPACE.lg, paddingTop: SPACE.md },
    card: { ...COLUMN, flexGrow: 1, justifyContent: 'center', paddingHorizontal: SPACE.xl, paddingVertical: SPACE.lg },
    cardContent: { alignItems: 'stretch', gap: SPACE.lg },
    artCard: { borderRadius: RADIUS.tile, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.card, boxShadow: c.tileShadow || undefined },
    art: { width: '100%', aspectRatio: 4 / 3 },
    iconTile: { alignSelf: 'center', width: 128, height: 128, borderRadius: RADIUS.tile + 12, borderCurve: 'continuous', backgroundColor: c.selected, alignItems: 'center', justifyContent: 'center' },
    textCard: { gap: SPACE.md, padding: SPACE.xl },
    title: { ...TYPE.display, color: c.text },
    body: { ...TEXT.row, lineHeight: 24, color: c.secondaryText },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: SPACE.sm, paddingVertical: SPACE.lg },
    dot: { width: 8, height: 8, borderRadius: RADIUS.pill, backgroundColor: c.dot },
    // The current card's dot stretches into a pill.
    dotActive: { width: 24, backgroundColor: c.link },
    bottom: { ...COLUMN, paddingHorizontal: SPACE.xxl, paddingBottom: SPACE.xxl },
  });
