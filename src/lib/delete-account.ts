// Deleting an account (T9; SPEC-identity.md), from Settings or for an under-18 profile at sign-up
// (T6): the photo files (Storage doesn't cascade), Sign in with Apple's token (App Review requires
// revoking it), the Stripe Customer and its cards (T92), the account itself, then what this phone keeps for it. One path for both, so neither
// forgets a step (review, 2026-10-04: the under-18 deletion skipped Apple's revoke). Not mid-challenge
// (decision 103): while a challenge you're in or back hasn't ended, it stops before removing anything,
// and delete_account() refuses too (0052). Nor with money in Kept (decision 151, 0065): Kept balance, or money
// coming back that waits for a choice.

import type { Session } from '@supabase/supabase-js';

import { revokeAppleSignIn } from '@/lib/apple-sign-in';
import { removeAllAvatars } from '@/lib/avatar-storage';
import { removeAllCheckInPhotos } from '@/lib/check-in-photos';
import { removeAllFeedbackPhotos } from '@/lib/feedback-photos';
import { revokeGoogleSignIn } from '@/lib/google-sign-in';
import { deletionBlockedMessage, DELETION_BLOCKED_MESSAGE, MONEY_IN_KEPT_MESSAGE, moneyInKeptMessage } from '@/lib/challenges';
import { deleteStripeCustomer, forgetPaymentMethods, stripeEnabled } from '@/lib/payment-methods';
import { deviceQuickSignIn } from '@/lib/quick-sign-in';
import { supabase } from '@/lib/supabase';

/** Why this account can't be deleted yet (money still promised), or null. Throws if it can't tell. */
export async function deletionBlocker(userId: string): Promise<string | null> {
  const [running, pledges] = await Promise.all([
    supabase.from('challenges').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('outcome', null),
    supabase.rpc('my_pledges'),
  ]);
  if (running.error) throw running.error;
  if (pledges.error) throw pledges.error;
  const promised = deletionBlockedMessage(running.count ?? 0, (pledges.data as { outcome: string | null }[]).map((p) => p.outcome));
  // Money in Kept exists only where cards are real (the database checks again either way).
  if (promised || !stripeEnabled()) return promised;
  const [balance, back] = await Promise.all([supabase.rpc('my_balance'), supabase.rpc('my_money_back')]);
  if (balance.error) throw balance.error;
  if (back.error) throw back.error;
  return moneyInKeptMessage(balance.data as number, (back.data as unknown[]).length);
}

/** Thrown when money is still promised; its message says what to do. */
export class DeletionBlockedError extends Error {}

/**
 * Deletes the signed-in account and its traces; throws if the account itself couldn't be deleted
 * (a DeletionBlockedError while money is still promised, before anything is removed). The caller signs out.
 */
export async function deleteAccount(session: Session): Promise<void> {
  const userId = session.user.id;
  const blocked = await deletionBlocker(userId);
  if (blocked) throw new DeletionBlockedError(blocked);
  // A failure here doesn't stop the deletion: the scheduled job sweeps any photo left behind.
  await removeAllAvatars(userId).catch(() => {});
  await removeAllCheckInPhotos(userId).catch(() => {});
  await removeAllFeedbackPhotos(userId).catch(() => {});
  if (session.user.app_metadata.provider === 'apple') await revokeAppleSignIn();
  if (session.user.app_metadata.provider === 'google') await revokeGoogleSignIn();
  await deleteStripeCustomer();
  const { error } = await supabase.rpc('delete_account');
  if (error?.message === 'money_still_promised') throw new DeletionBlockedError(DELETION_BLOCKED_MESSAGE);
  if (error?.message === 'money_in_kept') throw new DeletionBlockedError(MONEY_IN_KEPT_MESSAGE);
  if (error) throw error;
  // The account is gone, so its saved Face ID sign-in (T38) and pretend payment methods (T49) go too.
  await deviceQuickSignIn.forget().catch(() => {});
  await forgetPaymentMethods(userId);
}
