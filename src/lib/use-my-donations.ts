// The signed-in user's donations (T62): every gift recorded in their name when a challenge ended (failed stakes,
// pledges sent to the charity, the charity's half of bought shields, extra gifts), newest first, and their total.
// Home, Me and Wallet all read it, so "given to charity" is one number everywhere (T208, plan.md decision 173).
// Row-level security returns only the user's own.

import { donationsTotalCents, type MyDonation } from '@/lib/pledges';
import { supabase } from '@/lib/supabase';
import { must, useFocusLoad } from '@/lib/use-focus-load';

/** `donations` is null until the first load; `totalCents` is 0 until then. */
export function useMyDonations(): { donations: MyDonation[] | null; totalCents: number; failed: boolean; reload: () => void } {
  const { data, failed, reload } = useFocusLoad(
    async () =>
      must(await supabase.from('donations').select('id, source, amount_cents, habit, created_at, status, given_on, charities(name)').order('created_at', { ascending: false })) as unknown as MyDonation[],
  );
  return { donations: data, totalCents: data ? donationsTotalCents(data) : 0, failed, reload };
}
