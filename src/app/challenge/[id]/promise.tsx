// "Your signed promise" (T204, plan.md decision 171), from a challenge's Manage: the promise it was signed with,
// word for word, the signature (drawn, or the full name adopted in script) and when. It reads
// challenge_signatures (0082), which only the signer can. A challenge started before signatures were kept, or
// from an older build, says so.

import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SignatureMark } from '@/components/signature-pad';
import { LoadingScreen } from '@/components/step-screen';
import { Tile } from '@/components/tile';
import { supabase } from '@/lib/supabase';
import { ICON, SCREEN, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { must, useFocusLoad } from '@/lib/use-focus-load';

type Signed = { kind: 'drawn' | 'adopted'; strokes: string | null; signed_name: string; contract_text: string; signed_at: string };

export default function SignedPromise() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  // An X at the top right as well as the swipe down, as on the results sheet (owner, 2026-11-02).
  const closeButton = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={SPACE.md}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <SymbolView name={{ ios: 'xmark', android: 'close' }} size={ICON.row - 2} tintColor={colors.text} />
          </Pressable>
        ),
      }}
    />
  );
  const { data, failed, reload } = useFocusLoad(
    async () => ({
      signed: must(
        await supabase.from('challenge_signatures').select('kind, strokes, signed_name, contract_text, signed_at').eq('challenge_id', id).maybeSingle(),
      ) as Signed | null,
    }),
    id,
  );
  if (!data) {
    return (
      <>
        {closeButton}
        <LoadingScreen failed={failed} onRetry={reload} />
      </>
    );
  }
  const { signed } = data;
  // The headline, then each paragraph, as the sign step showed them (one blank line apart).
  const [headline, ...paragraphs] = signed?.contract_text.split('\n\n') ?? [];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={SCREEN}>
      {closeButton}
      <Text style={styles.title} accessibilityRole="header">
        Your signed promise
      </Text>
      {signed ? (
        <>
          <Tile style={styles.promise}>
            <Text style={styles.headline}>{headline}</Text>
            {paragraphs.map((paragraph) => (
              <Text key={paragraph} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}
            <View style={styles.signatureBlock}>
              <SignatureMark
                signature={signed.kind === 'drawn' ? { kind: 'drawn', strokes: signed.strokes ?? '' } : { kind: 'adopted' }}
                name={signed.signed_name}
              />
              <View style={styles.line} />
              <Text style={styles.caption}>
                Signed by {signed.signed_name}, {new Date(signed.signed_at).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}
              </Text>
            </View>
          </Tile>
          <Text style={styles.footer}>Kept keeps this with your challenge. Only you can see it.</Text>
        </>
      ) : (
        <Text style={styles.paragraph}>This challenge was started before Kept kept a copy of the signed promise.</Text>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    title: { ...TYPE.display, color: c.text },
    promise: { gap: SPACE.md, padding: SPACE.xl },
    headline: { ...TYPE.title, color: c.text },
    paragraph: { ...TEXT.note, color: c.secondaryText },
    signatureBlock: { gap: SPACE.sm, marginTop: SPACE.md },
    line: { height: 2, backgroundColor: c.link },
    caption: { ...TEXT.caption, color: c.link, fontWeight: '600' },
    footer: { ...TEXT.caption, color: c.secondaryText, marginHorizontal: SPACE.sm },
    pressed: { opacity: 0.7 },
  });
