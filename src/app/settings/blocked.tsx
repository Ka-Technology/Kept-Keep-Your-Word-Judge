// Settings → Privacy & security → Blocked accounts (T53): everyone the user has blocked, newest
// first, like the iPhone's blocked contacts, from my_blocks() (migration 0035). A block made from a
// stranger's public challenge stays anonymous here too. Tapping one offers Unblock, which lets the
// two find each other again but brings back no friendship or request. As in the A3 mockup since T134
// (full-set/ui-set-7-blocked.jpg): "Blocked people" large, each person a card with their photo and a
// green Unblock.

import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { ListScreen } from '@/components/list';
import { LoadingScreen } from '@/components/step-screen';
import { PageTitle } from '@/components/tab-title';
import { Tile } from '@/components/tile';
import { supabase } from '@/lib/supabase';
import { ICON, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';
import { must, useFocusLoad } from '@/lib/use-focus-load';

type Block = { id: string; username: string | null; avatar_path: string | null; anonymous: boolean; created_at: string };

export default function BlockedAccounts() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { data: blocks, failed, reload } = useFocusLoad(async () => must(await supabase.rpc('my_blocks')) as Block[]);

  if (!blocks) return <LoadingScreen failed={failed} onRetry={reload} message="Couldn’t load your blocked accounts." />;

  async function unblock(block: Block) {
    await supabase.rpc('unblock', { block: block.id });
    reload();
  }

  return (
    <ListScreen>
      <PageTitle title="Blocked people" />
      {blocks.length === 0 && (
        <Text style={styles.note}>You haven’t blocked anyone. Block someone from their profile, a check-in or a public challenge.</Text>
      )}
      {blocks.map((b) => {
        const label = b.username ? `@${b.username}` : 'A public challenge’s challenger';
        const when = new Date(b.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
        return (
          <Tile key={b.id} style={styles.card}>
            {b.username ? (
              <Avatar path={b.avatar_path} username={b.username} size={56} />
            ) : (
              <View style={styles.anonymous}>
                <SymbolView name={{ ios: 'person.fill.questionmark', android: 'person' }} size={ICON.row} tintColor={colors.secondaryText} />
              </View>
            )}
            <View style={styles.text} accessible accessibilityLabel={`${label}, blocked ${when}`}>
              <Text style={styles.name} numberOfLines={1}>
                {label}
              </Text>
              <Text style={styles.when}>Blocked {when}</Text>
            </View>
            <Pressable onPress={() => unblock(b)} accessibilityRole="button" accessibilityLabel={`Unblock ${label}`} hitSlop={12}>
              <Text style={styles.unblock}>Unblock</Text>
            </Pressable>
          </Tile>
        );
      })}
      {blocks.length > 0 && (
        <Text style={styles.note}>
          They can’t see your challenges or send you requests. Unblocking lets you find each other again; it doesn’t bring back a friendship or a
          request.
        </Text>
      )}
    </ListScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.lg,
      padding: SPACE.lg,
    },
    anonymous: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: c.groupedBackground },
    text: { flex: 1, gap: SPACE.xxs },
    name: { ...TEXT.row, color: c.text, fontWeight: '700' },
    when: { ...TEXT.caption, color: c.secondaryText },
    unblock: { ...TEXT.row, color: c.link, fontWeight: '600' },
    note: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
  });
