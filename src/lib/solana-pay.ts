// Cancelling a Solana challenge that hasn't been paid (T169; owner, 2026-10-26). Nothing was taken, so
// nothing comes back: the challenge is removed, as if never signed, through solana-pay's `cancel`, which
// first looks on chain and waits while the wallet may still be sending. The challenge screen and the Pay
// sheet both ask with this. An unpaid card challenge (T93) cancels through `payments`, which first checks
// whether the card payment went through after all.

import { FunctionsHttpError } from '@supabase/supabase-js';
import { AccessibilityInfo, Alert } from 'react-native';

import { supabase } from './supabase';

/** What solana-pay's refusals mean to the challenger. */
const REFUSALS: Record<string, string> = {
  wallet_busy: 'Your wallet may still be sending this payment. Try again in a few minutes.',
  already_paid: 'Your payment arrived, so this challenge has started.',
};

/** Removes the unpaid challenge; null when it's gone (or already was), otherwise why not. */
async function cancelUnpaid(challengeId: string, card: boolean): Promise<string | null> {
  if (card) {
    const { data, error } = await supabase.functions.invoke('payments', { body: { action: 'cancel', challenge: challengeId } });
    if (error) return 'Couldn’t cancel this challenge. Check your connection and try again.';
    return data?.status === 'paid' ? 'Your card payment went through, so this challenge has started.' : null;
  }
  const { error } = await supabase.functions.invoke('solana-pay', { body: { action: 'cancel', challenge: challengeId } });
  if (!error) return null;
  const code = error instanceof FunctionsHttpError ? (await error.context.json().catch(() => null))?.error : null;
  if (code === 'expired') return null;
  return REFUSALS[code] ?? 'Couldn’t cancel this challenge. Check your connection and try again.';
}

/**
 * Asks before cancelling an unpaid challenge, then cancels it. `onDone` runs once it's removed; `onRefused`
 * gets the reason it wasn't (it's also read out to VoiceOver).
 */
export function askToCancelUnpaid(challengeId: string, onDone: () => void, onRefused: (message: string) => void, card = false) {
  Alert.alert('Cancel this challenge?', 'Nothing has been paid, so nothing is taken and nothing comes back. The challenge is removed.', [
    { text: 'Keep it', style: 'cancel' },
    {
      text: 'Cancel challenge',
      style: 'destructive',
      onPress: async () => {
        const message = await cancelUnpaid(challengeId, card);
        if (!message) return onDone();
        AccessibilityInfo.announceForAccessibility(message);
        onRefused(message);
      },
    },
  ]);
}
