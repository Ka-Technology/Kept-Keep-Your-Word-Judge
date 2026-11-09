// Wallet's "Your Solana wallet" (owner, 2026-11-06): what the user's own wallet holds, in the tokens Kept takes, so
// they know before staking. Kept reads it from Solana by its public address (lib/solana-wallet.ts): nothing to
// connect or sign. Off unless Solana stakes are.

import { useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { readClipboard } from '@/components/code-input';
import { ListRow, ListSection } from '@/components/list';
import { useAuth } from '@/lib/auth';
import { solanaPayEnabled } from '@/lib/challenges';
import { knownWallet, saveWallet, shortAddress, validWalletAddress, walletBalances } from '@/lib/solana-wallet';
import { useFocusLoad } from '@/lib/use-focus-load';

export function SolanaWalletSection() {
  const userId = useAuth().session?.user.id;
  const on = solanaPayEnabled();
  const { data, failed, reload } = useFocusLoad(
    async () => {
      const wallet = await knownWallet(userId!);
      return { wallet, balances: wallet ? await walletBalances(wallet) : [] };
    },
    on ? userId : null,
  );
  const [pasteError, setPasteError] = useState<string | null>(null);
  if (!on) return null;

  /** Takes the address from the clipboard, and says so if what's there isn't one. */
  async function paste() {
    const address = validWalletAddress(await readClipboard());
    if (!address) {
      const message = 'That isn’t a Solana address. In your wallet, tap your address to copy it, then try again.';
      setPasteError(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    setPasteError(null);
    await saveWallet(userId!, address);
    reload();
  }

  const help = 'Kept only reads this, from Solana: it can’t move anything. In Phantom or Solflare, tap your address to copy it.';
  // A failed read shows no balances: what's left from before may be another wallet's.
  const shown = failed ? null : data;
  return (
    <ListSection title="Your Solana wallet" footer={shown?.wallet ? `${shortAddress(shown.wallet)} on Solana's devnet. ${help}` : help}>
      {failed && <ListRow label="Couldn’t read your wallet" detail="Tap to try again" onPress={reload} first />}
      {shown?.balances.map((b, i) => (
        <ListRow key={b.token} label={b.token} value={b.amount} first={i === 0} />
      ))}
      {failed || data ? (
        <ListRow
          label={failed || shown?.wallet ? 'Use a different wallet' : 'See what’s in your wallet'}
          detail={pasteError ?? 'Pastes the address you copied'}
          onPress={paste}
          first={!failed && !shown?.wallet}
        />
      ) : (
        <ListRow label="Loading…" first />
      )}
    </ListSection>
  );
}
