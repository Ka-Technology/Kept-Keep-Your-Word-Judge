// Settings → App settings (T48): Appearance (System, Light or Dark; T41), and whether Home greets you
// by first name or username (T146, decision 101). Text size isn't a Kept setting: Kept follows the
// phone's own Text Size. As in the A3 mockup since T132 (full-set/ui-set-5-app.jpg): "App" large, the
// Appearance card with a System / Light / Dark switch, the greeting the same way, and "Show the
// tutorial again".

import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ListRow, ListScreen, ListSection } from '@/components/list';
import { Segmented } from '@/components/segmented';
import { PageTitle } from '@/components/tab-title';
import { Tile } from '@/components/tile';
import { loadAppearance, switchAppearance, type AppearancePreference } from '@/lib/appearance';
import { useAuth } from '@/lib/auth';
import { loadGreetBy, saveGreetBy, type GreetBy } from '@/lib/greet-by';
import { ICON, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/** The Appearance choices, in the order shown. */
const APPEARANCES: { value: AppearancePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

// ponytail: fixed to how long Segmented's spring takes to settle; give Segmented an onSettle if that spring changes.
const THUMB_SLIDE_MS = 250;

export default function AppSettings() {
  const [appearance, setAppearance] = useState<AppearancePreference>('system');
  const [greetBy, setGreetBy] = useState<GreetBy>('name');
  const { profile } = useAuth();
  const reduced = useReducedMotion();
  const switching = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    loadAppearance().then(setAppearance);
    loadGreetBy().then(setGreetBy);
  }, []);

  /**
   * Switches the app's look with a short crossfade and remembers it, once the switch's thumb has slid
   * over: the crossfade starts from a still of the screen, which would otherwise freeze the thumb halfway.
   */
  function chooseAppearance(preference: AppearancePreference) {
    setAppearance(preference);
    clearTimeout(switching.current);
    switching.current = setTimeout(() => switchAppearance(preference), reduced ? 0 : THUMB_SLIDE_MS);
  }

  function chooseGreetBy(choice: GreetBy) {
    setGreetBy(choice);
    saveGreetBy(choice);
  }

  return (
    <ListScreen>
      <PageTitle title="App" />
      <ChoiceCard title="Appearance" icon={{ ios: 'sun.max', android: 'light_mode' }} note="System matches your phone's light or dark setting.">
        <Segmented label="Appearance" options={APPEARANCES} value={appearance} onChange={chooseAppearance} />
      </ChoiceCard>
      <ChoiceCard
        title="Greeting"
        icon={{ ios: 'hand.wave', android: 'waving_hand' }}
        note={profile?.first_name ? 'How Home says hello.' : 'How Home says hello. Until you add your name in Personal info, it uses your username.'}
      >
        <Segmented
          label="Greeting"
          options={[
            { value: 'name', label: 'First name' },
            { value: 'username', label: 'Username' },
          ]}
          value={greetBy}
          onChange={chooseGreetBy}
        />
      </ChoiceCard>
      <ListSection footer="Kept follows your phone's text size: Settings → Display & Brightness → Text Size.">
        <ListRow label="Show the tutorial again" icon={{ ios: 'book', android: 'menu_book' }} onPress={() => router.push('/tutorial')} first />
      </ListSection>
    </ListScreen>
  );
}

/** A card headed by an outline icon and a title, holding one switch of choices, its note under it. */
function ChoiceCard({ title, icon, note, children }: { title: string; icon: SymbolViewProps['name']; note: string; children: ReactNode }) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Tile style={styles.card}>
        <View style={styles.head}>
          <SymbolView name={icon} size={ICON.hero} tintColor={colors.text} />
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
        </View>
        {children}
      </Tile>
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    section: { gap: SPACE.sm },
    card: { gap: SPACE.md, padding: SPACE.lg },
    head: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    title: { ...TYPE.title, color: c.text },
    note: { ...TEXT.caption, color: c.secondaryText, marginHorizontal: SPACE.sm },
  });
