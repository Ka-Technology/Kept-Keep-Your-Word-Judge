// An extra gift to a challenge's charity once it has ended (T32; SPEC-pledges.md decision 11): a
// pretend amount from $1 to $100, given once and raised later. Used on the results screen (the
// challenger) and the pledge screen (a pledger). Migration 0023 checks every rule again. With real cards (T93's
// leftover, migration 0079) it's charged when given, with no fee, and saved once paid.

import { useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { DollarInput } from '@/components/dollar-input';
import { ErrorText } from '@/components/error-text';
import { parseStakeDollars } from '@/lib/challenges';
import { CardDeclined, PaymentsError, payByCard, stripeEnabled } from '@/lib/payment-methods';
import { giftError, giftErrorMessage } from '@/lib/pledges';
import { cardAuthorization } from '@/lib/policies';
import { supabase } from '@/lib/supabase';
import { SPACE, TEXT, useStyles, type Colors } from '@/lib/theme';
import { must, useFocusLoad } from '@/lib/use-focus-load';

/** The gift box. `onSaved` lets the screen refresh its totals. Its number pad has iOS's own Done (DollarInput, T214). */
export function GiftForm({ challengeId, charityName, onSaved }: { challengeId: string; charityName: string; onSaved?: () => void }) {
  const styles = useStyles(makeStyles);
  // null while loading; 0 when the user hasn't given yet.
  const { data: givenCents, reload } = useFocusLoad(
    async () => must(await supabase.from('extra_gifts').select('amount_cents').eq('challenge_id', challengeId).maybeSingle())?.amount_cents ?? 0,
    challengeId,
  );
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Read synchronously, so a double tap can't give twice.
  const inFlight = useRef(false);

  if (givenCents === null) return null;
  const current = givenCents / 100;

  async function give() {
    const dollars = parseStakeDollars(text);
    const problem = giftError(dollars, current);
    if (problem) return setError(problem);
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      if (stripeEnabled()) {
        await payByCard({ gift: { challenge: challengeId, amountCents: dollars! * 100 } }, cardAuthorization('gift'));
      } else {
        const { error } = current
          ? await supabase.from('extra_gifts').update({ amount_cents: dollars! * 100 }).eq('challenge_id', challengeId)
          : await supabase.from('extra_gifts').insert({ challenge_id: challengeId, amount_cents: dollars! * 100 });
        if (error) throw error;
      }
      setText('');
      AccessibilityInfo.announceForAccessibility(`Your gift to ${charityName} is $${dollars}.`);
      onSaved?.();
    } catch (e) {
      const message =
        e instanceof CardDeclined
          ? e.message
          : giftErrorMessage(e instanceof PaymentsError ? { code: e.answer?.code ?? e.code, message: e.answer?.message ?? e.code } : (e as { code?: string; message?: string }));
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      inFlight.current = false;
      setSaving(false);
      reload();
    }
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{current ? `Your gift to ${charityName}: $${current}. Raise it to` : `Add a gift to ${charityName}`}</Text>
      <DollarInput value={text} onChangeText={setText} placeholder={current ? String(current + 5) : '10'} accessibilityLabel={current ? 'New gift in dollars' : 'Gift in dollars'} />
      <Text style={styles.explanation}>It goes to {charityName} whatever the outcome.</Text>
      {stripeEnabled() && <Text style={styles.explanation}>{cardAuthorization('gift')}</Text>}
      <ErrorText message={error} />
      <Button title={saving ? 'Saving…' : current ? 'Raise gift' : 'Give'} onPress={give} disabled={saving || !text} variant="secondary" />
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    field: { gap: SPACE.sm },
    label: { ...TEXT.caption, color: c.secondaryText, marginLeft: SPACE.xs },
    explanation: { ...TEXT.note, color: c.secondaryText, marginHorizontal: SPACE.xs },
  });
