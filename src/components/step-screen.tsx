// The frame every Start a challenge step shares: a five-part progress bar with "2 of 5" beside it
// (ProgressBar, one look for the whole flow and sign-up, A3 T109), a question with an optional line
// under it, the step's fields and an error if the step can't go on, scrolling. The main button floats over
// them at the bottom, with no bar behind it, so Next is always in reach however long the step is; the list
// scrolls up clear of it (owner, 2026-10-26). A step where the choice is the whole point (a habit, a charity)
// shows the button only once something is chosen (`showButton`), sliding up into place from the bottom of
// the screen. The keyboard simply covers the button while it's up. Also the states a screen shows before it has content: loading (or failed), and empty.

import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { Skeleton } from '@/components/skeleton';
import { COLUMN, RADIUS, SPACE, TEXT, TYPE, useStyles, type Colors } from '@/lib/theme';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/** Steps in the Start a challenge flow: habit, length, stake, charity, sign. */
const STEP_COUNT = 5;

/** How far along a flow is: `count` segments, the first `step` of them green, and "2 of 5". Read as "Step 2 of 5". */
export function ProgressBar({ step, count }: { step: number; count: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.progressRow} accessible accessibilityRole="progressbar" accessibilityLabel={`Step ${step} of ${count}`}>
      <View style={styles.progress}>
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={[styles.segment, i < step && styles.segmentDone]} />
        ))}
      </View>
      <Text style={styles.stepOf}>
        {step} of {count}
      </Text>
    </View>
  );
}

export function StepScreen({
  step,
  question,
  subtitle,
  children,
  error,
  buttonTitle = 'Next',
  onPress,
  disabled = false,
  showButton = true,
  scrollRef,
  scrollEnabled = true,
}: {
  step: number;
  question: string;
  /** A line under the question. */
  subtitle?: string;
  children: ReactNode;
  /** Why the step can't go on yet; read out to VoiceOver users. */
  error?: string | null;
  buttonTitle?: string;
  onPress: () => void;
  disabled?: boolean;
  /** False until the step has its choice: only the button waits; an error still shows. */
  showButton?: boolean;
  /** Lets a step scroll itself, e.g. to bring a text box above the keyboard. */
  scrollRef?: Ref<ScrollViewInstance>;
  /** False holds the step still, e.g. while a finger draws a signature. */
  scrollEnabled?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const bottom = useSafeAreaInsets().bottom;
  const reduced = useReducedMotion();
  // 0 = waiting below the screen, 1 = in place. A step that starts with its button just has it there.
  const [reveal] = useState(() => new Animated.Value(showButton ? 1 : 0));
  // The floating button's height, so the end of the list can scroll up above it.
  const [buttonRoom, setButtonRoom] = useState(0);
  useEffect(() => {
    if (!showButton || reduced) return reveal.setValue(showButton ? 1 : 0);
    Animated.timing(reveal, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [showButton, reduced, reveal]);
  return (
    <View style={styles.screen}>
      {/* No automatic inset: the header already sits above the screen, and iOS added its height again as
          an empty band (owner, 2026-10-03). */}
      <ScrollView
        ref={scrollRef}
        scrollEnabled={scrollEnabled}
        style={styles.scroll}
        contentContainerStyle={[styles.container, { paddingBottom: buttonRoom + SPACE.lg }]}
        // Makes room for the keyboard (iOS), so a box near the bottom can scroll above it.
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        <ProgressBar step={step} count={STEP_COUNT} />
        <View style={styles.heading}>
          <Text style={styles.question} accessibilityRole="header">
            {question}
          </Text>
          {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
        <View style={styles.fields}>{children}</View>
        <ErrorText message={error} />
      </ScrollView>
      {/* Over the list, transparent: taps outside the button reach the list. The home indicator's room is added by hand. */}
      <View
        style={[styles.floating, { paddingBottom: bottom + SPACE.md }]}
        pointerEvents="box-none"
        onLayout={(e) => setButtonRoom(e.nativeEvent.layout.height)}
      >
        <Animated.View
          style={[styles.floatingButton, { opacity: reveal, transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) }] }]}
          pointerEvents={showButton ? 'auto' : 'none'}
          accessibilityElementsHidden={!showButton}
          importantForAccessibility={showButton ? 'auto' : 'no-hide-descendants'}
        >
          <Button title={buttonTitle} onPress={onPress} disabled={disabled} />
        </Animated.View>
      </View>
    </View>
  );
}

/**
 * Shown while a screen (a step, a challenge, results) loads what it needs, as placeholder tiles, or
 * `message` and a retry if that failed. `hero` draws the bento's shapes (a big tile beside two small
 * ones) for screens that open with one; without it, plain cards, for lists. `inline` fits it into a
 * tab's content instead of filling the screen.
 */
export function LoadingScreen({
  failed,
  onRetry,
  message = 'Couldn’t load this step. Check your connection and try again.',
  inline = false,
  hero = false,
}: {
  failed: boolean;
  onRetry: () => void;
  message?: string;
  inline?: boolean;
  hero?: boolean;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={inline ? styles.inline : failed ? styles.center : styles.top}>
      {failed ? (
        <>
          <Text style={[styles.message, inline && styles.inlineMessage]} accessibilityRole="alert">
            {message}
          </Text>
          <Button title="Try again" onPress={onRetry} variant="secondary" />
        </>
      ) : (
        <Skeleton hero={hero} />
      )}
    </View>
  );
}

/** Where a list has nothing in it yet: one sentence, and one button to the way to fill it. */
export function EmptyState({
  text,
  action,
  onPress,
  variant = 'primary',
}: {
  text: string;
  action: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.inline}>
      <Text style={[styles.message, styles.inlineMessage]}>{text}</Text>
      <Button title={action} onPress={onPress} variant={variant} />
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    scroll: { flex: 1 },
    container: { ...COLUMN, padding: SPACE.xl, gap: SPACE.xl },
    floating: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: SPACE.xl, alignItems: 'center' },
    floatingButton: { width: '100%', maxWidth: COLUMN.maxWidth - 2 * SPACE.xl },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    progress: { flex: 1, flexDirection: 'row', gap: SPACE.xs },
    stepOf: { ...TEXT.caption, color: c.secondaryText, fontVariant: ['tabular-nums'] },
    segment: { flex: 1, height: 6, borderRadius: RADIUS.pill, backgroundColor: c.track },
    segmentDone: { backgroundColor: c.stamp },
    heading: { gap: SPACE.xs },
    question: { ...TYPE.display, color: c.text },
    subtitle: { ...TEXT.body, color: c.secondaryText },
    fields: { gap: SPACE.lg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.md, padding: SPACE.xxl, backgroundColor: c.groupedBackground },
    top: { ...COLUMN, flex: 1, padding: SPACE.lg, backgroundColor: c.groupedBackground },
    message: { ...TEXT.body, color: c.text, textAlign: 'center' },
    inline: { gap: SPACE.md },
    inlineMessage: { color: c.secondaryText, textAlign: 'left', marginHorizontal: SPACE.xs },
  });
