// Stakes paid on Solana (T168, T169; SPEC-payments.md "Solana"). The app opens
// `solana:<this function>?challenge=<id>`, a Solana Pay transaction request, and the wallet (Phantom,
// Solflare or any Solana Pay wallet) calls it signed out:
//   GET                          { label, icon } for the wallet's screen;
//   POST { account }             a transfer of the stake plus Kept's fee, in the challenge's token, from
//                                that wallet to Kept's treasury, carrying the payment's reference key,
//                                with Kept as fee payer (already signed), so the user needs no SOL. The
//                                wallet signs and sends it; the app never sees a key. On devnet, a wallet
//                                short of Kept's own test USDT is topped up first, once (T222).
//                                With SOLANA_ESCROW_PROGRAM set, a USDC or USDT stake goes into Kept's escrow
//                                program instead (T230, decision 178): the fee to the treasury, the stake locked
//                                in the challenge's own escrow account, from which only the program's `settle`
//                                (Kept's key: the challenger or the charity named at signing) or, after its
//                                timeout, `reclaim` (to the challenger) can move it. Which way a payment goes is
//                                fixed on its first fetch.
// A pledge paid in crypto (T171, migration 0073) is the same, with `?payment=<id>` (start_crypto_pledge()'s
// answer) in place of `?challenge=<id>`, and `{ action: 'check', payment }`.
// The app, also signed out of this function (`auth: 'none'`, the id is the only input):
//   POST { action: 'check', challenge }   looks for the payment on chain now; answers { status }:
//                                         'awaiting', 'paid' or 'expired' (the challenge is gone, or
//                                         never had a payment).
// The app, with the challenger's token:
//   POST { action: 'cancel', challenge }  removes an unpaid challenge, once Kept has looked on chain and
//                                         no transfer the wallet fetched can still land ('wallet_busy',
//                                         409, until then); 'already_paid' (409) if it arrived after all.
// pg_cron, every minute while a payment is awaited (migration 0055), with the secret key:
//   POST { action: 'sweep' }     checks every awaited payment, and removes challenges nobody paid for.
// pg_cron every minute while a payout is due or sent, and the database right after an ending (migration 0072,
// T170), with the secret key:
//   POST { action: 'payouts' }   settles each sent payout from its signature's status, then sends each due one
//                                from the treasury (a transferChecked the treasury key signs), once: it's marked
//                                sent with its signature before it's broadcast, and sent again only after its
//                                blockhash expired without it landing (solana.ts payoutStep).
// A payment counts only once the transfer is finalized with the right token, amount and destination
// (solana.ts paidBy, SPEC.md rule 5); the database records it (solana_payment_confirmed), never the app.
// Secrets: SOLANA_TREASURY (the treasury's address), SOLANA_FEE_PAYER_KEY (the fee payer's 64-byte key,
// as Solana's CLI writes it), and optionally SOLANA_CLUSTER (default devnet) and SOLANA_RPC_URL (default
// Solana's public devnet endpoint). Without the first two it answers `not_configured` (503). Payouts also need
// SOLANA_TREASURY_KEY (the treasury's 64-byte key); without it they wait, and nothing is sent.

import { withSupabase } from 'npm:@supabase/server@^1';
import { verifyAuth } from 'npm:@supabase/server@^1/core';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2';
// Small @solana/* packages by exact version, not @solana/kit and @solana-program/token: those pull in about
// 30 packages, and Supabase's server timed out bundling them (2026-10-26).
import { address, getAddressDecoder, getProgramDerivedAddress, getAddressEncoder, type Address } from 'npm:@solana/addresses@8.5.0';
import { AccountRole, type Instruction } from 'npm:@solana/instructions@8.5.0';
import { pipe } from 'npm:@solana/functional@8.5.0';
import { createSolanaRpc } from 'npm:@solana/rpc@8.5.0';
import type { Signature } from 'npm:@solana/keys@8.5.0';
import {
  createKeyPairSignerFromBytes,
  createNoopSigner,
  partiallySignTransactionMessageWithSigners,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
  type InstructionWithSigners,
} from 'npm:@solana/signers@8.5.0';
import { appendTransactionMessageInstructions, createTransactionMessage, setTransactionMessageLifetimeUsingBlockhash } from 'npm:@solana/transaction-messages@8.5.0';
import { getBase64EncodedWireTransaction, getSignatureFromTransaction } from 'npm:@solana/transactions@8.5.0';

import {
  ASSOCIATED_TOKEN_PROGRAM,
  baseUnits,
  CHARITY_SEED,
  CREATE_IDEMPOTENT_DATA,
  decodeEscrow,
  ESCROW_DONATED,
  ESCROW_LOCKED,
  ESCROW_REFUNDED,
  ESCROW_SEED,
  escrowValid,
  expired,
  LAST_REQUEST_MINUTES,
  lockData,
  lockedBy,
  mintToCheckedData,
  paidBy,
  PAY_WITHIN_MINUTES,
  payoutStep,
  reclaimAfter,
  settleData,
  shortfall,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  TOKENS,
  topUp,
  transferCheckedData,
  uuidBytes,
  validAddress,
  validId,
  type ParsedTransaction,
} from './solana.ts';

const ICON = 'https://habitkept.com/apple-touch-icon.png';
const cluster = Deno.env.get('SOLANA_CLUSTER') ?? 'devnet';
const rpc = createSolanaRpc(Deno.env.get('SOLANA_RPC_URL') ?? 'https://api.devnet.solana.com');
const treasury = Deno.env.get('SOLANA_TREASURY');
const feePayerKey = Deno.env.get('SOLANA_FEE_PAYER_KEY');
const treasuryKey = Deno.env.get('SOLANA_TREASURY_KEY');
// Kept's escrow program (T230, decision 178): set, new USDC and USDT stakes lock in it rather than the treasury.
// Its KEPT key is the fee payer's, which signs every lock and settle.
const escrowProgram = Deno.env.get('SOLANA_ESCROW_PROGRAM');

/** Any instruction, its signers carried on its accounts. */
type Ix = Pick<Instruction, 'programAddress' | 'data'> & InstructionWithSigners;

/** Supabase's runtime: work that goes on after the answer is sent (supabase.com/docs/guides/functions/background-tasks). */
declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void } | undefined;

/**
 * After a wallet fetches its transfer, Kept watches for it for this long, every WATCH_EVERY_MS: the transfer can
 * land only while its blockhash is valid (about a minute), and the free plan lets a function run 150 s.
 */
const WATCH_MS = 100_000;
const WATCH_EVERY_MS = 2_000;

type Payment = {
  id: string;
  user_id: string;
  token: string;
  stake_cents: number;
  fee_cents: number;
  reference: string | null;
  status: 'awaiting' | 'confirmed' | 'expired';
  kind: 'stake' | 'pledge';
  created_at: string;
  requested_at: string | null;
  challenge_id: string | null;
  /** The stake's escrow account, and its charity's, once a wallet fetched an escrowed transfer (migration 0084). */
  escrow: string | null;
  escrow_charity: string | null;
};
const COLUMNS = 'id, user_id, token, stake_cents, fee_cents, reference, status, kind, created_at, requested_at, challenge_id, escrow, escrow_charity';

/** An error answer. `message` is what a wallet shows (Solana Pay's error format). */
const fail = (error: string, status: number) => Response.json({ error, message: MESSAGES[error] ?? 'Kept couldn’t load this payment.' }, { status });
const MESSAGES: Record<string, string> = {
  expired: 'This payment link expired. Start the challenge again in Kept.',
  already_paid: 'This payment was already made.',
  account_invalid: 'That wallet address isn’t valid.',
  token_unsupported: 'Kept doesn’t take that token yet.',
  not_configured: 'Kept’s payments aren’t set up yet.',
  wallet_busy: 'Your wallet may still be sending this payment. Try again in a few minutes.',
};

/**
 * Looks for the payment on chain and records it if found. True once it's paid. `confirmed` (a supermajority
 * of the cluster has voted on its block, a second or two after sending) rather than `finalized` (about 13
 * seconds more), so the challenger hears within seconds (owner, 2026-10-26: 3 to 5 seconds).
 */
async function confirm(admin: SupabaseClient, payment: Payment): Promise<boolean> {
  const token = TOKENS[cluster]?.[payment.token];
  if (!payment.reference || !token || !treasury) return false;
  const want = { reference: payment.reference, treasury, mint: token.mint, amount: baseUnits(payment.stake_cents + payment.fee_cents, token.decimals) };
  const found = await rpc.getSignaturesForAddress(address(payment.reference), { commitment: 'confirmed', limit: 20 }).send();
  for (const s of found) {
    if (s.err) continue;
    const tx = await rpc.getTransaction(s.signature, { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }).send();
    const stake = baseUnits(payment.stake_cents, token.decimals);
    const payer =
      tx &&
      (payment.escrow
        ? lockedBy(tx as unknown as ParsedTransaction, { reference: payment.reference, escrow: payment.escrow, treasury, mint: token.mint, stake, fee: baseUnits(payment.fee_cents, token.decimals) })
        : paidBy(tx as unknown as ParsedTransaction, want));
    if (!payer) continue;
    // A transfer into the vault without the program's lock would pass the balance check: the escrow itself must hold it.
    if (payment.escrow && !(await escrowHolds(payment, token.mint, stake, payer))) continue;
    const { error } = await admin.rpc('solana_payment_confirmed', { payment: payment.id, sig: s.signature, wallet: payer });
    if (error) throw error;
    return true;
  }
  return false;
}

/** Checks for the payment every WATCH_EVERY_MS until it's paid, no longer awaited, or WATCH_MS is up. */
async function watch(admin: SupabaseClient, paymentId: string): Promise<void> {
  const until = Date.now() + WATCH_MS;
  try {
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, WATCH_EVERY_MS));
      const { data, error } = await admin.from('solana_payments').select(COLUMNS).eq('id', paymentId).single();
      if (error) throw error;
      if (data.status !== 'awaiting' || (await confirm(admin, data as Payment))) return;
    }
  } catch (e) {
    // The minute sweep still finds it.
    console.error('solana-pay watch failed', e);
  }
}

/** An account's raw bytes, from getAccountInfo's base64 answer. */
const base64Bytes = (data: unknown) => Uint8Array.from(atob((data as [string, string])[0]), (c) => c.charCodeAt(0));

/**
 * A challenge's escrow account and its charity's account (T230): program addresses from the challenge id, and from
 * the sha256 of the charity's id, which is what the escrow keeps as the one charity its stake can go to.
 */
async function escrowAccounts(challengeId: string, charityId: string) {
  const program = address(escrowProgram!);
  const charity = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(charityId)));
  const [escrow] = await getProgramDerivedAddress({ programAddress: program, seeds: [ESCROW_SEED, uuidBytes(challengeId)] });
  const [charityOwner] = await getProgramDerivedAddress({ programAddress: program, seeds: [CHARITY_SEED, charity] });
  return { program, escrow, charityOwner, charity };
}

/**
 * Whether the payment's escrow account, owned by Kept's program, holds exactly its stake, locked, from the wallet
 * that paid, for the charity recorded on the payment.
 */
async function escrowHolds(payment: Payment, mint: string, stake: bigint, payer: string): Promise<boolean> {
  if (!escrowProgram) return false; // ponytail: switched off with escrows still awaited, they wait; turn it back on to count them
  const { value } = await rpc.getAccountInfo(address(payment.escrow!), { encoding: 'base64', commitment: 'confirmed' }).send();
  const escrow = value && value.owner === escrowProgram ? decodeEscrow(base64Bytes(value.data)) : null;
  if (!escrow) return false;
  const encoder = getAddressEncoder();
  const [charityOwner] = await getProgramDerivedAddress({ programAddress: address(escrowProgram), seeds: [CHARITY_SEED, escrow.charity] });
  return charityOwner === payment.escrow_charity && escrowValid(escrow, { challenger: new Uint8Array(encoder.encode(address(payer))), mint: new Uint8Array(encoder.encode(address(mint))), amount: stake });
}

/** A wallet's associated token account for a mint: the program derives it from the wallet, token program and mint. */
async function tokenAccount(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  const encoder = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    seeds: [encoder.encode(owner), encoder.encode(tokenProgram), encoder.encode(mint)],
  });
  return pda;
}

/** The signed-by-Kept transfer for `account` to sign, as base64, with the line the wallet shows. */
async function transaction(admin: SupabaseClient, payment: Payment, account: string): Promise<Response> {
  const token = TOKENS[cluster]?.[payment.token];
  if (!token) return fail('token_unsupported', 400);
  if (Date.now() - new Date(payment.created_at).getTime() > PAY_WITHIN_MINUTES * 60_000) return fail('expired', 410);

  const mint = address(token.mint);
  const tokenProgram = address(token.program);
  const owner = address(account);
  const source = await tokenAccount(owner, mint, tokenProgram);
  const amount = baseUnits(payment.stake_cents + payment.fee_cents, token.decimals);
  const feePayer = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(feePayerKey!)));
  // A wallet without enough of the token can't pay, and Phantom then only says it "failed to simulate"
  // (and, wrongly here, "not enough SOL"), so Kept says what's missing instead, and the wallet shows it.
  // On devnet, Kept's own test token is topped up instead, on the first fetch (T222).
  const { value: held } = await rpc.getAccountInfo(source, { encoding: 'jsonParsed', commitment: 'confirmed' }).send();
  const heldUnits = BigInt((held?.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } } | undefined)?.parsed?.info?.tokenAmount?.amount ?? '0');
  const extra = topUp(heldUnits, amount, { cluster, symbol: payment.token, firstRequest: payment.requested_at === null });
  if (extra) await mintTestTokens(feePayer, owner, source, mint, tokenProgram, token.decimals, extra);
  else {
    const missing = shortfall(heldUnits, amount, token.decimals, payment.token);
    if (missing) return Response.json({ error: 'not_enough_tokens', message: missing }, { status: 400 });
  }

  // The path sticks to the payment (T230): a stake first fetched while the escrow is on locks in it, and one whose
  // transfer was first fetched for the treasury stays there. Classic SPL tokens only: PYUSD is a Token-2022 token.
  let lock: (Awaited<ReturnType<typeof escrowAccounts>> & { lengthDays: number }) | null = null;
  if (payment.kind === 'stake' && escrowProgram && token.program === TOKEN_PROGRAM && (payment.escrow !== null || payment.reference === null)) {
    const { data: challenge, error } = await admin.from('challenges').select('charity_id, length_days').eq('id', payment.challenge_id).single();
    if (error) throw error;
    lock = { ...(await escrowAccounts(payment.challenge_id!, challenge.charity_id)), lengthDays: challenge.length_days };
  }

  // One reference per payment, however many times the wallet asks, written with the escrow's accounts.
  let reference = payment.reference;
  if (!reference) {
    const fresh = getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));
    const escrowColumns = lock ? { escrow: lock.escrow, escrow_charity: lock.charityOwner } : {};
    await admin.from('solana_payments').update({ reference: fresh, ...escrowColumns }).eq('id', payment.id).is('reference', null);
    const { data } = await admin.from('solana_payments').select('reference, escrow').eq('id', payment.id).single();
    reference = data?.reference as string;
    // Two first fetches at once: the one written decides the path.
    if (lock && data?.escrow !== lock.escrow) lock = null;
  }
  const { error } = await admin.from('solana_payments').update({ requested_at: new Date().toISOString() }).eq('id', payment.id);
  if (error) throw error;
  // Watch for it in the background, so the push goes out seconds after the wallet sends, even while the app
  // sleeps behind the wallet. A wallet that asks again within the watch reuses the watcher already running.
  const watching = payment.requested_at !== null && Date.now() - Date.parse(payment.requested_at) < WATCH_MS;
  if (!watching && typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(watch(admin, payment.id));

  const treasuryAddress = address(treasury!);
  const destination = await tokenAccount(treasuryAddress, mint, tokenProgram);
  const wallet = createNoopSigner(owner);
  // A transfer from the wallet, with the reference key on it, read-only, so the payment can be found by it.
  const pay = (to: Address, units: bigint) => ({
    programAddress: tokenProgram,
    accounts: [
      { address: source, role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.READONLY },
      { address: to, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY_SIGNER, signer: wallet },
      { address: address(reference), role: AccountRole.READONLY },
    ],
    data: transferCheckedData(units, token.decimals),
  }) as const;
  // The treasury's account for this token, made the first time it's paid in it (Kept pays the rent).
  const instructions: Ix[] = [createAccount(feePayer, destination, treasuryAddress, mint, tokenProgram)];
  if (lock) {
    // The fee to the treasury, then the escrow's vault (made first, so a vault someone else made can't block it), then
    // the lock, which Kept's key co-signs: only the program can move the stake after this.
    const vault = await tokenAccount(lock.escrow, mint, tokenProgram);
    instructions.push(pay(destination, baseUnits(payment.fee_cents, token.decimals)), createAccount(feePayer, vault, lock.escrow, mint, tokenProgram), {
      programAddress: lock.program,
      accounts: [
        { address: feePayer.address, role: AccountRole.WRITABLE_SIGNER, signer: feePayer },
        { address: owner, role: AccountRole.READONLY_SIGNER, signer: wallet },
        { address: mint, role: AccountRole.READONLY },
        { address: source, role: AccountRole.WRITABLE },
        { address: lock.escrow, role: AccountRole.WRITABLE },
        { address: vault, role: AccountRole.WRITABLE },
        { address: tokenProgram, role: AccountRole.READONLY },
        { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
      ],
      data: lockData(uuidBytes(payment.challenge_id!), baseUnits(payment.stake_cents, token.decimals), lock.charity, reclaimAfter(payment.created_at, lock.lengthDays)),
    });
  } else instructions.push(pay(destination, amount));

  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'finalized' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await partiallySignTransactionMessageWithSigners(message);
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const what = lock ? `${dollars(payment.stake_cents)} stake, locked on Solana until the challenge ends,` : `${dollars(payment.stake_cents)} ${payment.kind}`;
  return Response.json({
    transaction: getBase64EncodedWireTransaction(signed),
    message: `Your ${what} and Kept's ${dollars(payment.fee_cents)} fee, in ${payment.token}`,
  });
}

type Payout = {
  id: string;
  kind: 'return' | 'donation' | 'reward';
  to_wallet: string;
  token: string;
  amount_cents: number;
  status: 'due' | 'sent';
  signature: string | null;
  last_valid_height: number | null;
  solana_payments: { escrow: string | null };
};
type Signer = Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>;

/** The associated token program's CreateIdempotent for `owner`'s account of `mint`, Kept paying any rent. */
function createAccount(payer: Signer, account: Address, owner: Address, mint: Address, tokenProgram: Address) {
  return {
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    accounts: [
      { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
      { address: account, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
      { address: tokenProgram, role: AccountRole.READONLY },
    ],
    data: CREATE_IDEMPOTENT_DATA,
  } as const;
}

/**
 * Mints Kept's test token into a short wallet (T222, devnet only) as its own transaction, the fee payer as
 * mint authority, and waits until it's confirmed. Inside the payment it would break paidBy()'s check that the
 * payer paid exactly the amount.
 */
async function mintTestTokens(feePayer: Signer, owner: Address, account: Address, mint: Address, tokenProgram: Address, decimals: number, amount: bigint) {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          createAccount(feePayer, account, owner, mint, tokenProgram),
          {
            programAddress: tokenProgram,
            accounts: [
              { address: mint, role: AccountRole.WRITABLE },
              { address: account, role: AccountRole.WRITABLE },
              { address: feePayer.address, role: AccountRole.READONLY_SIGNER, signer: feePayer },
            ],
            data: mintToCheckedData(amount, decimals),
          },
        ],
        m,
      ),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const sig = getSignatureFromTransaction(signed);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
  for (let i = 0; i < 30; i++) {
    const { value } = await rpc.getSignatureStatuses([sig]).send();
    const status = value[0];
    if (status?.err) throw new Error(`top-up failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('top-up not confirmed in 15 s');
}

/**
 * Money out (T170, T230): settles what was sent, then sends what's due, each exactly once. A payout of a stake in
 * the escrow is the program's `settle`, signed by Kept's key; any other comes from the treasury.
 */
async function payouts(admin: SupabaseClient): Promise<{ sent: number; confirmed: number }> {
  const result = { sent: 0, confirmed: 0 };
  const treasurySigner = treasuryKey ? await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(treasuryKey))) : null;
  if (treasurySigner && treasurySigner.address !== treasury) throw new Error('SOLANA_TREASURY_KEY is not the key of SOLANA_TREASURY');
  const feePayer = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(feePayerKey!)));
  const { data, error } = await admin
    .from('solana_payouts')
    .select('id, kind, to_wallet, token, amount_cents, status, signature, last_valid_height, solana_payments!inner(escrow)')
    .in('status', ['due', 'sent'])
    .not('to_wallet', 'is', null)
    .order('created_at');
  if (error) throw error;
  const rows = data as unknown as Payout[];

  const height = await rpc.getBlockHeight({ commitment: 'finalized' }).send();
  for (const o of rows.filter((p) => p.status === 'sent')) {
    const { value } = await rpc.getSignatureStatuses([o.signature as Signature], { searchTransactionHistory: true }).send();
    const step = payoutStep(value[0] ?? null, height, BigInt(o.last_valid_height ?? 0));
    if (step === 'wait') continue;
    const { error: stepError } =
      step === 'expired'
        ? await admin.rpc('solana_payout_expired', { payout: o.id })
        : await admin.rpc('solana_payout_settled', { payout: o.id, landed: step === 'confirmed' });
    if (stepError) throw stepError;
    if (step === 'confirmed') result.confirmed++;
    else console.error('solana-pay: payout', step, o.id, o.signature);
  }

  // Only what was due when read: one just put back above goes out on the next run. One row's trouble never holds
  // up the others.
  for (const o of rows.filter((p) => p.status === 'due')) {
    try {
      if (await sendPayout(admin, o, feePayer, treasurySigner)) result.sent++;
    } catch (e) {
      console.error('solana-pay: payout failed', o.id, e);
    }
  }
  return result;
}

/** Sends one due payout, from the escrow or the treasury. True once it's broadcast; false when it waits. */
async function sendPayout(admin: SupabaseClient, o: Payout, feePayer: Signer, treasurySigner: Signer | null): Promise<boolean> {
  const token = TOKENS[cluster]?.[o.token];
  if (!token) return false;
  const mint = address(token.mint);
  const tokenProgram = address(token.program);
  const amount = baseUnits(o.amount_cents, token.decimals);
  const owner = address(o.to_wallet);
  const destination = await tokenAccount(owner, mint, tokenProgram);
  // The wallet's (or the charity's) account for this token, made again if it was closed (Kept pays the rent).
  const instructions: Ix[] = [createAccount(feePayer, destination, owner, mint, tokenProgram)];

  const escrow = o.solana_payments.escrow;
  if (escrow) {
    if (!escrowProgram) return false; // switched off: it waits
    // Only an escrow a finalized block shows, so the lock it settles can't be rolled back.
    const { value: account } = await rpc.getAccountInfo(address(escrow), { encoding: 'base64', commitment: 'finalized' }).send();
    const state = account && account.owner === escrowProgram ? decodeEscrow(base64Bytes(account.data))?.state : undefined;
    if (state === undefined) return false;
    if (state !== ESCROW_LOCKED) {
      await settledAlready(admin, o, escrow, state);
      return false;
    }
    const vault = await tokenAccount(address(escrow), mint, tokenProgram);
    instructions.push({
      programAddress: address(escrowProgram),
      accounts: [
        { address: feePayer.address, role: AccountRole.WRITABLE_SIGNER, signer: feePayer },
        { address: address(escrow), role: AccountRole.WRITABLE },
        { address: mint, role: AccountRole.READONLY },
        { address: vault, role: AccountRole.WRITABLE },
        { address: destination, role: AccountRole.WRITABLE },
        { address: tokenProgram, role: AccountRole.READONLY },
      ],
      data: settleData(o.kind === 'return'),
    });
  } else {
    if (!treasurySigner) {
      console.error('solana-pay: SOLANA_TREASURY_KEY not set, treasury payouts wait');
      return false;
    }
    const source = await tokenAccount(treasurySigner.address, mint, tokenProgram);
    // Only money the treasury holds for sure: what a finalized block shows (SPEC-payments.md).
    const { value: held } = await rpc.getTokenAccountBalance(source, { commitment: 'finalized' }).send();
    if (BigInt(held.amount) < amount) {
      console.error('solana-pay: the treasury is short for payout', o.id, o.token, held.amount, String(amount));
      return false;
    }
    instructions.push({
      programAddress: tokenProgram,
      accounts: [
        { address: source, role: AccountRole.WRITABLE },
        { address: mint, role: AccountRole.READONLY },
        { address: destination, role: AccountRole.WRITABLE },
        { address: treasurySigner.address, role: AccountRole.READONLY_SIGNER, signer: treasurySigner },
      ],
      data: transferCheckedData(amount, token.decimals),
    });
  }

  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'finalized' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const sig = getSignatureFromTransaction(signed);
  // Marked sent first: if this run dies after broadcasting, the next one finds the signature and never sends twice.
  const { data: marked, error: markError } = await admin.rpc('solana_payout_sending', { payout: o.id, sig, height: Number(blockhash.lastValidBlockHeight) });
  if (markError) throw markError;
  if (!marked) return false;
  try {
    await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
    return true;
  } catch (e) {
    // It stays sent: once its blockhash expires unseen, it's put back and sent afresh.
    console.error('solana-pay: payout broadcast failed', o.id, e);
    return false;
  }
}

/**
 * A due payout whose escrow already paid out (a settle whose answer was lost, or the challenger's reclaim): the
 * escrow's latest transaction is recorded as it, confirmed if the escrow went the payout's way, failed (for the
 * owner) if not. Nothing is sent.
 */
async function settledAlready(admin: SupabaseClient, o: Payout, escrow: string, state: number) {
  const found = await rpc.getSignaturesForAddress(address(escrow), { commitment: 'finalized', limit: 5 }).send();
  const last = found.find((s) => !s.err);
  if (!last) return;
  const wentThisWay = (state === ESCROW_REFUNDED && o.kind === 'return') || (state === ESCROW_DONATED && o.kind === 'donation');
  const { error } = await admin.rpc('solana_payout_sending', { payout: o.id, sig: last.signature, height: 0 });
  if (error) throw error;
  const { error: settleError } = await admin.rpc('solana_payout_settled', { payout: o.id, landed: wentThisWay });
  if (settleError) throw settleError;
  if (!wentThisWay) console.error('solana-pay: escrow paid out another way', o.id, escrow, state);
}

async function handle(req: Request, ctx: { supabaseAdmin: SupabaseClient }): Promise<Response> {
  if (req.method === 'GET') return Response.json({ label: 'Kept', icon: ICON });
  if (!treasury || !feePayerKey) return fail('not_configured', 503);
  const admin = ctx.supabaseAdmin;
  const body = await req.json().catch(() => ({}));

  if (body.action === 'payouts') {
    const auth = await verifyAuth(req, { auth: 'secret' });
    if (auth.error) return fail('unauthorized', 401);
    return Response.json(await payouts(admin));
  }

  if (body.action === 'sweep') {
    const auth = await verifyAuth(req, { auth: 'secret' });
    if (auth.error) return fail('unauthorized', 401);
    const { data, error } = await admin.from('solana_payments').select(COLUMNS).eq('status', 'awaiting');
    if (error) throw error;
    let paid = 0;
    let removed = 0;
    for (const payment of data as Payment[]) {
      if (await confirm(admin, payment)) paid++;
      else if (expired(payment, new Date())) {
        const { error } = await admin.rpc('solana_payment_expired', { payment: payment.id });
        if (error) throw error;
        removed++;
      }
    }
    return Response.json({ paid, removed });
  }

  // A stake's payment by its challenge; a pledge's by its own id (only `check` and the wallet's GET/POST name one).
  const params = new URL(req.url).searchParams;
  const pledgePayment = body.action === 'check' ? body.payment : body.action === 'cancel' ? null : params.get('payment');
  const challenge = body.action === 'check' || body.action === 'cancel' ? body.challenge : params.get('challenge');
  if (!validId(pledgePayment) && !validId(challenge)) return fail('challenge_invalid', 400);
  const { data: payment, error } = validId(pledgePayment)
    ? await admin.from('solana_payments').select(COLUMNS).eq('id', pledgePayment).eq('kind', 'pledge').maybeSingle()
    : await admin.from('solana_payments').select(COLUMNS).eq('challenge_id', challenge).eq('kind', 'stake').maybeSingle();
  if (error) throw error;
  // An expired payment's challenge is gone, so its row no longer points at it.
  if (!payment) return body.action === 'check' ? Response.json({ status: 'expired' }) : fail('expired', 410);

  if (body.action === 'check') {
    if (payment.status === 'awaiting' && (await confirm(admin, payment as Payment))) return Response.json({ status: 'paid' });
    return Response.json({ status: payment.status === 'confirmed' ? 'paid' : payment.status });
  }

  // The challenger gives up on an unpaid challenge: it's removed, as if never signed, and nothing was taken.
  // Only once Kept has looked on chain, and no transfer the wallet fetched can still land.
  if (body.action === 'cancel') {
    const { data: auth, error: authError } = await verifyAuth(req, { auth: 'user' });
    if (authError || auth?.userClaims?.id !== payment.user_id) return fail('unauthorized', 401);
    if (payment.status !== 'awaiting') return fail(payment.status === 'confirmed' ? 'already_paid' : 'expired', 409);
    if (await confirm(admin, payment as Payment)) return fail('already_paid', 409);
    if (payment.requested_at && Date.now() - Date.parse(payment.requested_at) < LAST_REQUEST_MINUTES * 60_000) return fail('wallet_busy', 409);
    const { error: expireError } = await admin.rpc('solana_payment_expired', { payment: payment.id });
    if (expireError) throw expireError;
    return Response.json({ status: 'cancelled' });
  }

  if (payment.status !== 'awaiting') return fail(payment.status === 'confirmed' ? 'already_paid' : 'expired', 409);
  if (!validAddress(body.account)) return fail('account_invalid', 400);
  return transaction(admin, payment as Payment, body.account);
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    try {
      return await handle(req, ctx);
    } catch (e) {
      // The log has the whole error. On devnet the answer carries its first line too, so a test shows what broke.
      console.error('solana-pay failed', e);
      const detail = cluster === 'devnet' ? String((e as Error)?.message ?? e).split('\n')[0].slice(0, 300) : undefined;
      return Response.json({ error: 'internal', message: 'Kept couldn’t build this payment. Try again in a moment.', detail }, { status: 500 });
    }
  }),
};
