// The rules of solana-pay that don't touch the network (T168, SPEC-payments.md "Solana"): which tokens
// Kept takes on which cluster, the amount in a token's smallest units, how to tell from a finalized
// transaction that a payment arrived, and when an unpaid challenge can be removed. No imports, so Deno
// and jest both load it (tested in solana.test.ts).

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export type Token = { mint: string; decimals: number; program: string };

/**
 * The dollar stablecoins Kept takes (owner, 2026-10-26), per cluster. Adding one is a line here, the
 * `pay_token` check (migration 0055) and SOLANA_TOKENS in src/lib/challenges.ts.
 * Devnet USDC is Circle's test mint (developers.circle.com) and devnet PYUSD Paxos's (solana.com/pyusd,
 * Token-2022, no transfer fee or hook). Tether has no devnet mint, so devnet USDT is Kept's own test
 * mint (6 decimals, the fee payer its mint authority; made by devnet.mjs on 2026-11-02, T221, replacing the
 * 2026-10-26 one whose authority was lost). ponytail: mainnet mints are added in S5 (T172),
 * each checked against its issuer's page.
 */
export const TOKENS: Record<string, Record<string, Token>> = {
  devnet: {
    USDC: { mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6, program: TOKEN_PROGRAM },
    USDT: { mint: 'C9RNqSLwZ6HN2DKin9ni18Jh9SaHZMsywVHajETZ8k6T', decimals: 6, program: TOKEN_PROGRAM },
    PYUSD: { mint: 'CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM', decimals: 6, program: TOKEN_2022_PROGRAM },
  },
};

export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';

// The two token instructions, written by hand because bundling @solana-program/token and everything it
// pulls in timed out on Supabase's deploy (2026-10-26). Built into whole transactions for USDC, USDT and
// PYUSD (Token-2022), they came out byte-for-byte equal to @solana-program/token's (checked 2026-10-26).

/** TransferChecked's data: instruction 12, the amount as 8 little-endian bytes, then the decimals. */
export function transferCheckedData(amount: bigint, decimals: number): Uint8Array {
  const data = new Uint8Array(10);
  data[0] = 12;
  new DataView(data.buffer).setBigUint64(1, amount, true);
  data[9] = decimals;
  return data;
}

/** The associated token program's CreateIdempotent: instruction 1, no arguments. */
export const CREATE_IDEMPOTENT_DATA = new Uint8Array([1]);

/** MintToChecked's data: instruction 14, the amount as 8 little-endian bytes, then the decimals. */
export function mintToCheckedData(amount: bigint, decimals: number): Uint8Array {
  const data = transferCheckedData(amount, decimals);
  data[0] = 14;
  return data;
}

/** Kept's own devnet test token, the one Kept can mint (the fee payer is its mint authority). */
export const KEPT_TEST_TOKEN = 'USDT';

/**
 * What to mint into a wallet before it pays (T222), so a judge with an empty devnet wallet needs no faucet:
 * the shortfall, only on devnet, only for Kept's own test token, and only on the payment's first fetch (the
 * transaction request is signed out, so a second ask gets nothing). Null when nothing is minted.
 */
export function topUp(held: bigint, needed: bigint, on: { cluster: string; symbol: string; firstRequest: boolean }): bigint | null {
  if (on.cluster !== 'devnet' || on.symbol !== KEPT_TEST_TOKEN || !on.firstRequest || held >= needed) return null;
  return needed - held;
}

/** Dollars in cents as a stablecoin's smallest units: $1 is 10^decimals units. */
export function baseUnits(cents: number, decimals: number): bigint {
  return (BigInt(cents) * 10n ** BigInt(decimals)) / 100n;
}

/** The parts of a `getTransaction` answer (jsonParsed) that the check reads. */
type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } };
export type ParsedTransaction = {
  meta: { err: unknown; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
  transaction: { message: { accountKeys: { pubkey: string }[] } };
};

/** How much each owner's balance of `mint` changed in a transaction. */
function changes(tx: ParsedTransaction, mint: string): Map<string, bigint> {
  const delta = new Map<string, bigint>();
  const add = (balances: TokenBalance[] | undefined, sign: bigint) => {
    for (const b of balances ?? []) {
      if (b.mint !== mint || !b.owner) continue;
      delta.set(b.owner, (delta.get(b.owner) ?? 0n) + sign * BigInt(b.uiTokenAmount.amount));
    }
  };
  add(tx.meta?.preTokenBalances, -1n);
  add(tx.meta?.postTokenBalances, 1n);
  return delta;
}

/**
 * The wallet that paid, if this transaction is the payment: it succeeded, carries the reference key,
 * and moved exactly `amount` of the token from one wallet to the treasury. Anything else (a failed
 * transaction, another token, a short or a different amount) is not the payment.
 */
export function paidBy(tx: ParsedTransaction, want: { reference: string; treasury: string; mint: string; amount: bigint }): string | null {
  if (!tx.meta || tx.meta.err !== null) return null;
  if (!tx.transaction.message.accountKeys.some((k) => k.pubkey === want.reference)) return null;
  const delta = changes(tx, want.mint);
  if (delta.get(want.treasury) !== want.amount) return null;
  const payers = [...delta].filter(([owner, d]) => owner !== want.treasury && d === -want.amount);
  return payers.length === 1 ? payers[0][0] : null;
}

// ── Kept's escrow program (T227, T230; decision 178) ──────────────────────────────────────────────────────
// A stake locked by `lock` sits in the escrow's vault until `settle` sends it to the challenger or to the charity
// named at signing. The layouts are Anchor's, from solana/kept_escrow.json (solana.test.ts checks them).

export const LOCK_DISCRIMINATOR = new Uint8Array([21, 19, 208, 43, 237, 62, 255, 87]);
export const SETTLE_DISCRIMINATOR = new Uint8Array([175, 42, 185, 87, 144, 131, 102, 212]);
export const ESCROW_ACCOUNT_DISCRIMINATOR = new Uint8Array([31, 213, 123, 187, 186, 22, 218, 155]);
/** The seeds of a challenge's escrow account and of a charity's account (with the charity id's sha256). */
export const ESCROW_SEED = new TextEncoder().encode('escrow');
export const CHARITY_SEED = new TextEncoder().encode('charity');
/** An Escrow account: discriminator, challenge id, challenger, mint, amount, charity hash, reclaim time, state, bump. */
export const ESCROW_SIZE = 8 + 16 + 32 + 32 + 8 + 32 + 8 + 1 + 1;
export const ESCROW_LOCKED = 0;
export const ESCROW_REFUNDED = 1;
export const ESCROW_DONATED = 2;

/** A challenge id (a UUID) as the 16 bytes the escrow is seeded with. */
export function uuidBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, '');
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

/** `lock`'s data: its discriminator, the challenge id, the stake in units, the charity hash, the reclaim time. */
export function lockData(challengeId: Uint8Array, amount: bigint, charity: Uint8Array, reclaimAt: bigint): Uint8Array {
  const data = new Uint8Array(72);
  const view = new DataView(data.buffer);
  data.set(LOCK_DISCRIMINATOR, 0);
  data.set(challengeId, 8);
  view.setBigUint64(24, amount, true);
  data.set(charity, 32);
  view.setBigInt64(64, reclaimAt, true);
  return data;
}

/** `settle`'s data: its discriminator, then 1 to send the stake back to the challenger, 0 to give it to the charity. */
export function settleData(refund: boolean): Uint8Array {
  const data = new Uint8Array(9);
  data.set(SETTLE_DISCRIMINATOR, 0);
  data[8] = refund ? 1 : 0;
  return data;
}

export type Escrow = { challengeId: Uint8Array; challenger: Uint8Array; mint: Uint8Array; amount: bigint; charity: Uint8Array; reclaimAfter: bigint; state: number };

/** An Escrow account's fields, or null if the bytes aren't one. Addresses stay as their 32 bytes. */
export function decodeEscrow(data: Uint8Array): Escrow | null {
  if (data.length !== ESCROW_SIZE || !ESCROW_ACCOUNT_DISCRIMINATOR.every((b, i) => data[i] === b)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    challengeId: data.slice(8, 24),
    challenger: data.slice(24, 56),
    mint: data.slice(56, 88),
    amount: view.getBigUint64(88, true),
    charity: data.slice(96, 128),
    reclaimAfter: view.getBigInt64(128, true),
    state: data[136],
  };
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Whether an escrow holds exactly this payment's stake, still locked, of this token, from the wallet that paid. */
export function escrowValid(escrow: Escrow, want: { challenger: Uint8Array; mint: Uint8Array; amount: bigint }): boolean {
  return escrow.state === ESCROW_LOCKED && escrow.amount === want.amount && sameBytes(escrow.mint, want.mint) && sameBytes(escrow.challenger, want.challenger);
}

/**
 * When anyone may send an unsettled stake back to its challenger: after Day 1 (tomorrow), the challenge's days, the
 * five extra days misses can add (two shields, three bought back), and 30 days' grace for Kept to settle. From the
 * payment's own time, so every fetch of the transaction carries the same one.
 */
export function reclaimAfter(paymentCreatedAt: string, lengthDays: number): bigint {
  return BigInt(Math.floor(Date.parse(paymentCreatedAt) / 1000) + (1 + lengthDays + 5 + 30) * 86400);
}

/**
 * The wallet that paid, if this transaction is an escrowed stake (T230): it succeeded, carries the reference key,
 * moved exactly the stake into the escrow's vault and exactly the fee to the treasury, both from one wallet.
 */
export function lockedBy(
  tx: ParsedTransaction,
  want: { reference: string; escrow: string; treasury: string; mint: string; stake: bigint; fee: bigint },
): string | null {
  if (!tx.meta || tx.meta.err !== null) return null;
  if (!tx.transaction.message.accountKeys.some((k) => k.pubkey === want.reference)) return null;
  const delta = changes(tx, want.mint);
  if (delta.get(want.escrow) !== want.stake || delta.get(want.treasury) !== want.fee) return null;
  const payers = [...delta].filter(([owner, d]) => owner !== want.escrow && owner !== want.treasury && d === -(want.stake + want.fee));
  return payers.length === 1 ? payers[0][0] : null;
}

/** Token units as a plain amount with cents: 8200000 units of a 6-decimal token is "8.20". */
export function tokenAmountText(units: bigint, decimals: number): string {
  return (Number(units) / 10 ** decimals).toFixed(2);
}

/** What the wallet is short of, in words for the wallet to show, or null when it holds enough. */
export function shortfall(held: bigint, needed: bigint, decimals: number, symbol: string): string | null {
  if (held >= needed) return null;
  return `This wallet has ${tokenAmountText(held, decimals)} ${symbol}, and the stake and fee need ${tokenAmountText(needed, decimals)} ${symbol}. Add ${symbol} on Solana to this wallet, or pick another token in Kept.`;
}

/** Minutes a signed challenge waits for its payment before it's removed (SPEC-payments.md). */
export const PAY_WITHIN_MINUTES = 15;
/**
 * A transfer can land only while its blockhash is valid (about 150 blocks, a minute or so) and is
 * finalized seconds later, so 3 minutes after a wallet last asked, none from that request can still arrive.
 */
export const LAST_REQUEST_MINUTES = 3;

/** Whether an unpaid challenge can be removed: past the wait, and no transfer it asked for can still land. */
export function expired(payment: { created_at: string; requested_at: string | null }, now: Date): boolean {
  const minutesSince = (iso: string) => (now.getTime() - new Date(iso).getTime()) / 60_000;
  return minutesSince(payment.created_at) >= PAY_WITHIN_MINUTES && (payment.requested_at === null || minutesSince(payment.requested_at) >= LAST_REQUEST_MINUTES);
}

/**
 * What to do with a payout that was sent (T170), from its signature's status (getSignatureStatuses, searching
 * history) and the finalized block height: confirmed once the cluster voted on it; failed if it landed with an
 * error (the owner looks; it's never re-sent); expired, to be sent afresh, only once its blockhash is past and it
 * was never seen, so it can never land; otherwise wait. Only processed isn't enough either way: a minority fork
 * can still drop it.
 */
export function payoutStep(
  status: { err: unknown; confirmationStatus: string | null } | null,
  blockHeight: bigint,
  lastValidHeight: bigint,
): 'confirmed' | 'failed' | 'expired' | 'wait' {
  if (status) {
    if (status.confirmationStatus !== 'confirmed' && status.confirmationStatus !== 'finalized') return 'wait';
    return status.err === null ? 'confirmed' : 'failed';
  }
  return blockHeight > lastValidHeight ? 'expired' : 'wait';
}

/** A wallet address as Solana writes it: 32 to 44 base58 characters. */
export function validAddress(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

/** A challenge id from the link: a UUID. */
export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
