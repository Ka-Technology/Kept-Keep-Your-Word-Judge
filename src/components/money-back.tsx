// Money coming back, waiting for its owner's choice (T189, decision 145): each row opens "Keep it in Kept"
// (Kept balance, no fee when it's used) or, for a return, "Send it back to your card". A reward can only
// stay in Kept until bank payouts (T190). Wallet lists every one; a challenge's results screen lists its
// own, so a finisher can keep their stake and reward right there (owner, 2026-10-28). The rows come from
// my_money_back() (migrations 0063, 0064): only money really collected, never the demo's pretend amounts.
// Since decision 158 a reward lands in Kept balance by itself, and a return nobody chooses for goes back to
// its card after 14 days (migration 0067); each return's row says when.

import { Alert } from 'react-native';

import { ListRow } from '@/components/list';
import { money } from '@/lib/challenges';
import { showMenu } from '@/lib/menu';
import { payments } from '@/lib/payment-methods';
import { moneyBackDetail, moneyBackLabel, type MoneyBack } from '@/lib/pledges';
import { supabase } from '@/lib/supabase';

/** One row per payout waiting for a choice; `onChanged` reloads once one has moved. */
export function MoneyBackRows({ rows, onChanged, first = false }: { rows: MoneyBack[]; onChanged: () => void; first?: boolean }) {
  function choose(m: MoneyBack) {
    const run = (action: () => Promise<unknown>) => async () => {
      try {
        await action();
      } catch {
        Alert.alert('Couldn’t move your money', 'Check your connection and try again.');
      }
      onChanged();
    };
    showMenu(`${moneyBackLabel(m)}, ${money(m.amount_cents)}`, [
      {
        label: 'Keep it in Kept: no fee when you use it',
        run: run(async () => {
          const { error } = await supabase.rpc('keep_in_balance', { payout: m.id });
          if (error) throw error;
        }),
      },
      ...(m.kind === 'return' ? [{ label: 'Send it back to your card', run: run(() => payments({ action: 'send-back', payout: m.id })) }] : []),
    ]);
  }

  return rows.map((m, i) => (
    <ListRow key={m.id} label={moneyBackLabel(m)} detail={moneyBackDetail(m)} value={money(m.amount_cents)} onPress={() => choose(m)} first={first && i === 0} />
  ));
}
