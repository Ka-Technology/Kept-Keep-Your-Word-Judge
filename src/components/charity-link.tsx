// "About {charity} on Every.org": opens the charity's Every.org page in the in-app browser, so a backer pledging
// to it can read what it does without leaving Kept. Shows nothing for a charity without a slug. (The charity
// step uses a swipe on the charity's card instead: components/swipe-row.tsx.)

import { Pressable, StyleSheet, Text } from 'react-native';

import { charityPageUrl, openCharityPage } from '@/lib/charities';
import { SPACE, TEXT, useStyles, type Colors } from '@/lib/theme';

export function CharityLink({ name, slug }: { name: string; slug: string | null | undefined }) {
  const styles = useStyles(makeStyles);
  if (!charityPageUrl(slug)) return null;
  return (
    <Pressable onPress={() => openCharityPage(slug)} accessibilityRole="link" accessibilityLabel={`About ${name} on Every.org`} hitSlop={12}>
      <Text style={styles.link}>About {name} on Every.org</Text>
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    link: { ...TEXT.note, color: c.link, fontWeight: '600', marginHorizontal: SPACE.xs },
  });
