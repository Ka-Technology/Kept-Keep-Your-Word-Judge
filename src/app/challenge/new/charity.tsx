// Start a challenge, step 4 of 5 (as in the A3 mockup since T112, full-set/sheet-new.jpg "charity"):
// "If you don't finish", the charity the stake goes to, as cards that each say what the charity does
// (owner, 2026-10-02), with its logo or a heart mark (not the K box, which means a kept day) and a check circle.
// Kept's picks show first; typing 3 letters or more searches any US nonprofit through Every.org instead
// (the `charities` Edge Function, which holds the API key). A picked search result becomes a charity row
// only when the user taps Next. Without the key, or offline, search says so and Kept's picks still work.

import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, TextInput, View } from 'react-native';

import { ChoiceGrid } from '@/components/choice-grid';
import { Field } from '@/components/field';
import { LoadingScreen, StepScreen } from '@/components/step-screen';
import { charityPageUrl, openCharityPage, pickCharity, searchCharities, searchedChoice, SEARCH_MIN_LETTERS, useDebounced, type SearchedChoice } from '@/lib/charities';
import type { ChallengeDraft } from '@/lib/challenges';
import { bareInputStyle, ICON, PLACEHOLDER_COLOR, RADIUS, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';
import { useChoices, type Choice } from '@/lib/use-choices';
import { useFocusLoad } from '@/lib/use-focus-load';

/** The mark at the start of a charity card: its logo if it has one, else a heart. */
function CharityMark({ logoUrl }: { logoUrl?: string | null }) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  return (
    <View style={styles.mark}>
      {logoUrl ? (
        <Image source={{ uri: logoUrl }} style={styles.logo} contentFit="contain" accessibilityElementsHidden />
      ) : (
        <SymbolView name={{ ios: 'heart.fill', android: 'favorite' }} size={ICON.row} tintColor={colors.stamp} />
      )}
    </View>
  );
}

export default function CharityStep() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const draft = useLocalSearchParams<ChallengeDraft>();
  const { choices, failed, retry } = useChoices('charities');
  const [search, setSearch] = useState('');
  // What's chosen, kept whole: a search result isn't in `choices`, and it stays chosen as the search changes.
  const [chosen, setChosen] = useState<(Choice & { ein?: string }) | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  // Read synchronously, so a double tap can't pick twice.
  const inFlight = useRef(false);

  const typed = search.trim();
  const term = useDebounced(typed);
  const searching = typed.length >= SEARCH_MIN_LETTERS;
  // One search per pause in typing. The answer carries its term, so a late one for an older term is ignored.
  const found = useFocusLoad(async () => ({ term, outcome: await searchCharities(term) }), term.length >= SEARCH_MIN_LETTERS ? term : null);
  const answered = found.data?.term === term && term === typed ? found.data.outcome : null;

  if (!choices) return <LoadingScreen failed={failed} onRetry={retry} />;

  const results: SearchedChoice[] = answered && answered !== 'unavailable' ? answered.map(searchedChoice) : [];
  const shown: Choice[] = searching ? results : choices;
  const logos = new Map([...choices, ...results].map((c) => [c.id, c.logoUrl]));
  const problem = chosen ? null : 'Choose a charity.';

  const slugOf = (id: string) => [...choices, ...results].find((c) => c.id === id)?.slug;

  function choose(id: string) {
    const option = [...choices!, ...results].find((c) => c.id === id);
    if (option) setChosen(option);
    setPickError(null);
  }

  async function next() {
    setAttempted(true);
    if (!chosen) return AccessibilityInfo.announceForAccessibility('Choose a charity.');
    if (inFlight.current) return;
    let { id, name } = chosen;
    if (chosen.ein) {
      // A searched nonprofit: the server makes it a charity row, from Every.org's own answer, then says its id and name.
      inFlight.current = true;
      setPicking(true);
      const row = await pickCharity(chosen.ein);
      inFlight.current = false;
      setPicking(false);
      if (!row) {
        setPickError('Couldn’t save that choice. Check your connection and try again, or pick one of Kept’s choices.');
        return AccessibilityInfo.announceForAccessibility('Couldn’t save that choice.');
      }
      ({ id, name } = row);
    }
    router.push({ pathname: '/challenge/new/sign', params: { ...draft, charityId: id, charityName: name } });
  }

  return (
    <StepScreen
      step={4}
      question="If you don’t finish"
      subtitle={`Your $${draft.stake} stake goes to the charity you choose: one of Kept’s choices, or any US nonprofit found through Every.org. Kept gives it in its own name, so it’s not a tax receipt for you; your Wallet records it.`}
      error={pickError ?? (attempted ? problem : null)}
      onPress={next}
      disabled={picking}
      showButton={!!chosen}
    >
      <Field icon={{ ios: 'magnifyingglass', android: 'search' }}>
        <TextInput
          style={bareInputStyle(colors)}
          placeholder="Search any US nonprofit…"
          placeholderTextColor={PLACEHOLDER_COLOR}
          accessibilityLabel="Search charities"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </Field>
      <Text style={styles.heading} accessibilityRole="header">
        {searching ? 'Found through Every.org' : 'Kept’s choices'}
      </Text>
      {searching && !answered && <Text style={styles.label}>Searching…</Text>}
      {searching && answered === 'unavailable' && (
        <Text style={styles.label}>Search isn’t available right now. Clear the box to pick one of Kept’s choices.</Text>
      )}
      {searching && answered && answered !== 'unavailable' && results.length === 0 && <Text style={styles.label}>No nonprofit found for “{term}”.</Text>}
      {shown.length > 0 && <Text style={styles.label}>Swipe a charity left, or hold it, to learn more.</Text>}
      {shown.length > 0 && (
        <ChoiceGrid
          label={searching ? 'Search results' : 'Charity'}
          options={shown}
          value={chosen?.id ?? null}
          onChange={choose}
          icon={(id) => <CharityMark logoUrl={logos.get(id)} />}
          swipe={{
            canLearn: (id) => !!charityPageUrl(slugOf(id)),
            onLearn: (id) => openCharityPage(slugOf(id)),
          }}
        />
      )}
      {chosen && !shown.some((c) => c.id === chosen.id) && <Text style={styles.label}>Chosen: {chosen.name}</Text>}
    </StepScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    mark: { width: 44, height: 44, borderRadius: RADIUS.field, borderCurve: 'continuous', backgroundColor: c.selected, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    logo: { width: 36, height: 36 },
    heading: { ...TEXT.row, color: c.secondaryText, marginHorizontal: SPACE.xs },
    label: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
  });
