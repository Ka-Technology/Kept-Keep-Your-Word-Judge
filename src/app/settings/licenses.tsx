// Settings → About → Open-source licenses (T179): every third-party package in the app, with its version and
// license; tapping one shows its notice (copyright and license text). From lib/licenses.ts, which
// scripts/licenses.mjs writes from the dependency tree. A FlatList, since there are hundreds.

import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { ListRow } from '@/components/list';
import { PageTitle } from '@/components/tab-title';
import { LICENSED, noticeText } from '@/lib/licenses';
import { RADIUS, SCREEN, SPACE, TEXT, useStyles, type Colors } from '@/lib/theme';

export default function Licenses() {
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      data={LICENSED}
      keyExtractor={(p) => `${p.name}@${p.version}`}
      ListHeaderComponent={
        <View style={styles.head}>
          <PageTitle title="Open-source licenses" />
          <Text style={styles.note}>Kept is built with these packages. Tap one to read its license.</Text>
        </View>
      }
      renderItem={({ item, index }) => {
        const key = `${item.name}@${item.version}`;
        return (
          <View style={[styles.item, index === 0 && styles.top, index === LICENSED.length - 1 && styles.bottom]}>
            <ListRow label={item.name} detail={`${item.version} · ${item.license}`} onPress={() => setOpen(open === key ? null : key)} first={index === 0} />
            {open === key && (
              <Text style={styles.notice} selectable>
                {noticeText(item)}
              </Text>
            )}
          </View>
        );
      }}
    />
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: { ...SCREEN, gap: 0 },
    head: { gap: SPACE.md, marginBottom: SPACE.lg },
    note: { ...TEXT.note, color: c.secondaryText },
    // The rows sit in one card, as a ListSection's do.
    item: { backgroundColor: c.card, overflow: 'hidden' },
    top: { borderTopLeftRadius: RADIUS.tile, borderTopRightRadius: RADIUS.tile },
    bottom: { borderBottomLeftRadius: RADIUS.tile, borderBottomRightRadius: RADIUS.tile },
    notice: { ...TEXT.caption, color: c.secondaryText, padding: SPACE.lg },
  });
