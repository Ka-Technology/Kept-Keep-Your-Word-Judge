// Start a challenge (owner, 2026-10-01; as in the A3 mockup since T108, full-set/sheet-new.jpg
// "money"): one button for both kinds, which first asks whether money is on it. Two cards to choose
// from, nothing preselected, then Continue: "Yes, stake money" opens the five steps (habit.tsx: one
// of Kept's habits, each with its own check); "No, just track it" opens a free tracker
// (tracker/new.tsx: any habit the user names, no money, photo or AI). An X closes it.

import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DayStamp } from '@/components/big-stamp';
import { Button } from '@/components/button';
import { COLUMN, ICON, RADIUS, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';

type Kind = 'stake' | 'free';

const CHOICES: { kind: Kind; title: string; body: string }[] = [
  { kind: 'stake', title: 'Yes, stake money', body: 'Finish and it comes back. Don’t, and it goes to a charity you choose.' },
  { kind: 'free', title: 'No, just track it', body: 'Free. No money, photos or friends.' },
];

export default function NewChallenge() {
  const styles = useStyles(makeStyles);
  const c = useColors();
  const bottom = useSafeAreaInsets().bottom;
  const [kind, setKind] = useState<Kind | null>(null);

  return (
    <>
      <Stack.Screen
        options={{
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close" hitSlop={SPACE.md}>
              <SymbolView name={{ ios: 'xmark', android: 'close' }} size={ICON.row} tintColor={c.text} />
            </Pressable>
          ),
        }}
      />
      {/* No automatic inset: the header already sits above the screen, and iOS added its height again (owner, 2026-10-03). */}
      <ScrollView style={styles.screen} contentContainerStyle={[styles.container, { paddingBottom: bottom + SPACE.xxxl }]}>
        <Text style={styles.question} accessibilityRole="header">
          Put money on it?
        </Text>
        <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel="Put money on it?">
          {CHOICES.map((choice) => {
            const chosen = kind === choice.kind;
            return (
              <Pressable
                key={choice.kind}
                onPress={() => setKind(choice.kind)}
                style={({ pressed }) => [styles.card, chosen && styles.chosen, pressed && styles.pressed]}
                accessibilityRole="radio"
                accessibilityState={{ checked: chosen }}
                accessibilityLabel={`${choice.title}. ${choice.body}`}
              >
                <View style={styles.cardText}>
                  <Text style={styles.title}>{choice.title}</Text>
                  <Text style={styles.body}>{choice.body}</Text>
                </View>
                {choice.kind === 'stake' && <DayStamp kind="kept" color={c.stamp} size={64} />}
              </Pressable>
            );
          })}
        </View>
        <Button
          title="Continue"
          onPress={() => router.push(kind === 'stake' ? '/challenge/new/habit' : '/tracker/new')}
          disabled={kind === null}
        />
      </ScrollView>
    </>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: { ...COLUMN, padding: SPACE.xl, gap: SPACE.xxl },
    question: { ...TYPE.display, color: c.text, marginTop: SPACE.lg },
    choices: { gap: SPACE.lg },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.md,
      padding: SPACE.xl,
      borderRadius: RADIUS.tile,
      borderCurve: 'continuous',
      borderWidth: 2,
      borderColor: 'transparent',
      backgroundColor: c.card,
      boxShadow: c.tileShadow || undefined,
    },
    chosen: { borderColor: c.stamp },
    pressed: { opacity: 0.85 },
    cardText: { flex: 1, gap: SPACE.xs },
    title: { ...TYPE.title, color: c.text },
    body: { ...TEXT.body, color: c.secondaryText },
  });
