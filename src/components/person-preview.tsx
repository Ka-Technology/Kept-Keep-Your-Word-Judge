// Who someone is, before a friend request is sent or accepted (T58; SPEC-friends.md, "The preview"):
// their photo (tap to see it large), username, the month they joined Kept and friends in common. It loads person_preview()
// (migration 0034) for one exact username, which returns nothing else. Used after Find on the
// Friends screen, and in the sheet an incoming request opens. `large` is Add friend's (A3, T124): the
// photo big and centered, the username under it, then the two lines, friends in common with an icon.

import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TappableAvatar } from '@/components/photo-viewer';
import { memberSinceText, mutualFriendsText, type PersonPreview as Preview } from '@/lib/friends';
import { supabase } from '@/lib/supabase';
import { HERO_MAX_SCALE, ICON, RADIUS, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { must, useFocusLoad } from '@/lib/use-focus-load';

/** The preview card for `username`. A person the database won't show (a deleted account) gets a plain note. */
export function PersonPreview({ username, large = false }: { username: string; large?: boolean }) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { data, failed, reload } = useFocusLoad(
    async () => ({ name: username, person: (must(await supabase.rpc('person_preview', { name: username })) as Preview[])[0] ?? null }),
    username,
  );

  if (failed) return <Button title="Couldn’t load who this is. Try again" onPress={reload} variant="secondary" />;
  // Only ever this username's answer: the previous person's never shows while the next one loads.
  if (!data || data.name !== username) return <Text style={styles.note}>Loading…</Text>;
  const person = data.person;
  if (!person) return <Text style={styles.note}>This person can’t be shown.</Text>;

  const lines = [memberSinceText(person.member_since), mutualFriendsText(person.mutual_count, person.mutual_names)];
  if (large) {
    return (
      <View style={styles.large} accessible accessibilityLabel={[person.username, ...lines].join('. ')}>
        <TappableAvatar path={person.avatar_path} username={person.username} size={160} />
        <Text style={styles.largeName} adjustsFontSizeToFit numberOfLines={1} maxFontSizeMultiplier={HERO_MAX_SCALE}>
          @{person.username}
        </Text>
        <Text style={styles.largeNote}>{lines[0]}</Text>
        <View style={styles.mutual}>
          <SymbolView name={{ ios: 'person.2', android: 'group' }} size={ICON.row} tintColor={colors.secondaryText} />
          <Text style={styles.largeNote}>{lines[1]}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.card} accessible accessibilityLabel={[person.username, ...lines].join('. ')}>
      <TappableAvatar path={person.avatar_path} username={person.username} size={64} />
      <View style={styles.text}>
        <Text style={styles.name}>{person.username}</Text>
        {lines.map((line) => (
          <Text key={line} style={styles.note}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: { flexDirection: 'row', alignItems: 'center', gap: SPACE.lg, backgroundColor: c.card, borderRadius: RADIUS.tile, borderCurve: 'continuous', padding: SPACE.lg, boxShadow: c.tileShadow || undefined },
    text: { flex: 1, gap: SPACE.xxs },
    name: { ...TYPE.heading, color: c.text },
    note: { ...TEXT.note, color: c.secondaryText },
    large: { alignItems: 'center', gap: SPACE.sm, paddingTop: SPACE.xxl },
    largeName: { ...TYPE.display, color: c.text, marginTop: SPACE.md },
    largeNote: { ...TEXT.row, color: c.secondaryText, textAlign: 'center' },
    mutual: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  });
