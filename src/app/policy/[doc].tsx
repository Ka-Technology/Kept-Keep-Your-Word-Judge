// One of Kept's policies (T50): terms, privacy, refunds or community rules, from lib/policies.ts.
// Opened from Settings → About Kept, Settings → Privacy & security, and the sign-up screen, so the
// root layout registers it outside the signed-in guard. As in the A3 mockup since T142
// (full-set/ui-other-1-policy.jpg): the title large with the draft notice under it, then the intro
// and each section in a card, the real text unchanged.

import { useLocalSearchParams } from 'expo-router';
import { Fragment } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PageTitle } from '@/components/tab-title';
import { Tile } from '@/components/tile';
import { DRAFT_NOTICE, isPolicyId, POLICIES, POLICIES_UPDATED } from '@/lib/policies';
import { COLUMN, SPACE, TEXT, TYPE, useStyles, type Colors } from '@/lib/theme';

export default function PolicyScreen() {
  const styles = useStyles(makeStyles);
  const { doc } = useLocalSearchParams<{ doc: string }>();
  if (!isPolicyId(doc)) return null;
  const { title, intro, sections } = POLICIES[doc];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="automatic">
      <PageTitle title={title} subtitle={`${DRAFT_NOTICE} Last updated ${POLICIES_UPDATED}.`} />
      <Tile style={styles.card}>
        <Text style={styles.body}>{intro}</Text>
      </Tile>
      {sections.map(({ heading, body }) => (
        <Tile key={heading} style={styles.card}>
          <Text style={styles.heading} accessibilityRole="header">
            {heading}
          </Text>
          {body.map((block, i) => (
            <Fragment key={i}>
              {typeof block === 'string' ? (
                <Text style={styles.body}>{block}</Text>
              ) : (
                block.map((item) => (
                  <View key={item} style={styles.bullet}>
                    <Text style={styles.body} importantForAccessibility="no" accessibilityElementsHidden>
                      •
                    </Text>
                    <Text style={[styles.body, styles.bulletText]}>{item}</Text>
                  </View>
                ))
              )}
            </Fragment>
          ))}
        </Tile>
      ))}
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: { ...COLUMN, padding: SPACE.lg, gap: SPACE.md },
    card: { gap: SPACE.sm, padding: SPACE.xl },
    heading: { ...TYPE.title, color: c.text },
    body: { ...TEXT.body, color: c.secondaryText },
    bullet: { flexDirection: 'row', gap: SPACE.sm },
    bulletText: { flex: 1 },
  });
