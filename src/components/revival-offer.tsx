// The quiet offer to keep a challenge going (owner, 2026-10-01; SPEC-challenges.md "Revival
// shields"): one secondary button on a challenge its misses just ended, the day after the ending
// miss. No push, pop-up or countdown sells it. The price and its split show to the cent before
// paying; buy_shield() (migration 0039) checks every rule again and reopens the challenge. On the
// results screen it's a "Keep going?" card (A3, T103), its link opening the same confirmation.

import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { Tile } from '@/components/tile';
import { money, shieldErrorMessage, type ChallengeSummary } from '@/lib/challenges';
import { rescheduleShieldWarnings } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { ICON, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';

export function RevivalOffer({ challenge, onBought, card = false }: { challenge: ChallengeSummary; onBought: () => void; card?: boolean }) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Read synchronously, so a double tap can't buy two shields.
  const inFlight = useRef(false);
  const offer = challenge.revival;
  if (!offer) return null;
  const split = `${money(offer.charityCents)} goes to ${challenge.charityName} and ${money(offer.keptCents)} to Kept.`;

  async function buy() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('buy_shield', { challenge: challenge.id });
    inFlight.current = false;
    setBusy(false);
    if (error) {
      const message = shieldErrorMessage(error);
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    AccessibilityInfo.announceForAccessibility('Shield bought. Your challenge is running again.');
    rescheduleShieldWarnings();
    onBought();
  }

  function confirm() {
    Alert.alert(`Buy a shield for ${money(offer!.priceCents)}?`, `Your challenge keeps going, with one more day to complete. ${split} Friends and backers see this day as bought back.`, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Buy shield', onPress: buy },
    ]);
  }

  if (card) {
    return (
      <View style={styles.block}>
        <Tile style={styles.card} onPress={busy ? undefined : confirm} accessibilityLabel={`Keep going? Buy a shield for ${money(offer.priceCents)} and pick up where you left off.`}>
          <SymbolView name={{ ios: 'shield', android: 'shield' }} size={ICON.hero} tintColor={colors.text} />
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Keep going?</Text>
            <Text style={styles.cardBody}>{`Buy a shield for ${money(offer.priceCents)} and pick up where you left off. Until midnight.`}</Text>
            <Text style={styles.link}>{busy ? 'Buying…' : 'See the offer →'}</Text>
          </View>
        </Tile>
        <ErrorText message={error} />
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Button title={busy ? 'Buying…' : `Keep going with a shield, ${money(offer.priceCents)}`} onPress={confirm} disabled={busy} variant="secondary" />
      <Text style={styles.note}>{`Until midnight. ${split}`}</Text>
      <ErrorText message={error} />
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    block: { gap: SPACE.sm },
    note: { ...TEXT.caption, color: c.secondaryText, textAlign: 'center' },
    card: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.lg, padding: SPACE.xl },
    cardText: { flex: 1, gap: SPACE.xs },
    cardTitle: { ...TYPE.title, color: c.text },
    cardBody: { ...TEXT.note, color: c.secondaryText },
    link: { ...TEXT.note, color: c.text, fontWeight: '600', marginTop: SPACE.xs },
  });
