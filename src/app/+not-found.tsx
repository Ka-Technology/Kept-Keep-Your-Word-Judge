// A link to a screen that doesn't exist (an old or mistyped deep link, e.g. kept://nowhere): a plain
// sentence and a way home, instead of the router's generic page (owner, 2026-10-02, redesign pass).
// Home sends a signed-out user on to sign-in, as the route guards do everywhere. As in the A3 mockup
// since T143 (full-set/ui-other-2-not-found.jpg): the red X box over a card with "This page isn't
// here" and Go home.

import { router, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { DayStamp } from '@/components/big-stamp';
import { Button } from '@/components/button';
import { Tile } from '@/components/tile';
import { SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';

export default function NotFound() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  return (
    <View style={styles.center}>
      <Stack.Screen options={{ headerShown: false }} />
      <DayStamp kind="missed" color={colors.error} size={96} />
      <Tile style={styles.card}>
        <Text style={styles.title} accessibilityRole="header">
          This page isn’t here
        </Text>
        <Text style={styles.body}>The link may be old, or the page may have moved.</Text>
        <Button title="Go home" onPress={() => router.replace('/')} />
      </Tile>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.xl, padding: SPACE.xl, backgroundColor: c.background },
    card: {
      alignSelf: 'stretch',
      alignItems: 'stretch',
      gap: SPACE.md,
      padding: SPACE.xl,
    },
    title: { ...TYPE.display, color: c.text, textAlign: 'center' },
    body: { ...TEXT.body, color: c.secondaryText, textAlign: 'center' },
  });
