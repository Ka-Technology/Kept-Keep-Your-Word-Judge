// Kept's devnet end-to-end check (T223): plays a wallet against the test project's solana-pay, the way Phantom does.
//
//   node e2e.mjs            the treasury path
//   node e2e.mjs --escrow   the escrow program's path (T230)
//
// A: a $10 USDT stake paid from env/devnet-wallet.json (Kept tops it up, T222), cancelled on Day 1: the stake must
//    land back in the wallet, and the fee stays with Kept. In escrow, the wallet also fetches the transaction twice
//    and sends the second copy after the first has landed: it must take nothing (the program's other refusals are
//    proven on LiteSVM, solana/programs/kept-escrow/tests).
// B: another, left to miss days with the demo clock, then ended not finished: on the treasury its donation waits
//    with no address (Every.org's endpoint isn't in yet); in escrow it must land in the charity's vault.
// Prints the explorer links and exits 1 on any mismatch. Needs T221's keys and mint, the deploy, and the e2e
// account (`node scripts/seed-demo.mjs test`, which also clears its challenges afterwards). Test project only.

import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/addresses';
import { getBase64Encoder } from '@solana/codecs-strings';
import { createSolanaRpc } from '@solana/rpc';
import { createKeyPairSignerFromBytes } from '@solana/signers';
import { getBase64EncodedWireTransaction, getTransactionDecoder, partiallySignTransaction } from '@solana/transactions';

import { ASSOCIATED_TOKEN_PROGRAM, baseUnits, TOKENS } from '../functions/solana-pay/solana.ts';

const ROOT = new URL('../../', import.meta.url);
const TEST_REF = 'sevdqembylaqlazpjpwq';
const STAKE_CENTS = 1000;
const env = parseEnv(readFileSync(new URL('env/test.env', ROOT), 'utf8'));
const login = JSON.parse(readFileSync(new URL('env/demo.test.json', ROOT), 'utf8')).e2e;
const escrow = process.argv.includes('--escrow');
const usdt = TOKENS.devnet.USDT;

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};
const explorer = (what, id) => `https://explorer.solana.com/${what}/${id}?cluster=devnet`;

if (!env.EXPO_PUBLIC_SUPABASE_URL?.includes(TEST_REF)) fail('env/test.env does not point at the test project.');
if (!login) fail('No e2e account in env/demo.test.json: run `node scripts/seed-demo.mjs test` first.');

const rpc = createSolanaRpc(env.SOLANA_RPC_URL || 'https://api.devnet.solana.com');
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const wallet = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(new URL('env/devnet-wallet.json', ROOT), 'utf8'))));

/** Asks `check` until it answers truthy, every `everyMs`, or fails after `timeoutMs`. */
async function until(what, check, timeoutMs, everyMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  fail(`${what}: not within ${timeoutMs / 1000} s`);
}

/** The owner's USDT balance in units, 0 when their token account doesn't exist yet. */
async function usdtHeld(owner) {
  const encoder = getAddressEncoder();
  const [account] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    seeds: [encoder.encode(address(owner)), encoder.encode(address(usdt.program)), encoder.encode(address(usdt.mint))],
  });
  const { value } = await rpc.getAccountInfo(account, { encoding: 'jsonParsed', commitment: 'confirmed' }).send();
  return BigInt(value?.data?.parsed?.info?.tokenAmount?.amount ?? '0');
}

/** Asks solana-pay for the challenge's transaction, as the wallet does, and signs it. */
async function fetchSigned(label, id) {
  const res = await fetch(`${env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/solana-pay?challenge=${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: wallet.address }),
  });
  const body = await res.json();
  if (!res.ok) fail(`${label}: solana-pay answered ${res.status}: ${body.message ?? ''} ${body.detail ?? ''}`);
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(body.transaction));
  return { signed: await partiallySignTransaction([wallet.keyPair], transaction), message: body.message };
}

/**
 * Signs a challenge with a USDT stake, pays it from the wallet, and waits until Kept counts it paid. With `twice`,
 * the wallet fetches the transaction a second time before paying (as wallets can) and sends that copy afterwards:
 * on the escrow path it must fail and take nothing.
 */
async function startPaid(label, twice = false) {
  const { data: challenge, error } = await supabase
    .from('challenges')
    .insert({
      habit_id: 'journal',
      length_days: 28,
      stake_cents: STAKE_CENTS,
      charity_id: 'msf',
      payment_method: 'solana_usdc',
      pay_token: 'USDT',
      time_zone: 'America/Los_Angeles',
      consented_at: new Date().toISOString(),
      is_public: false,
      signature: { kind: 'adopted', contract_text: `E2E ${label}: I stake $10 on Journal for 28 days.` },
    })
    .select('id')
    .single();
  if (error) fail(`${label}: signing the challenge: ${error.message}`);
  const first = await fetchSigned(label, challenge.id);
  const second = twice ? await fetchSigned(label, challenge.id) : null;
  const signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(first.signed), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
  await until(
    `${label}: Kept counting the payment`,
    async () => (await supabase.functions.invoke('solana-pay', { body: { action: 'check', challenge: challenge.id } })).data?.status === 'paid',
    90_000,
    3_000,
  );
  console.log(`${label}: paid ("${first.message}") ${explorer('tx', signature)}`);
  if (second) {
    const before = await usdtHeld(wallet.address);
    const landed = await rpc
      .sendTransaction(getBase64EncodedWireTransaction(second.signed), { encoding: 'base64', preflightCommitment: 'confirmed' })
      .send()
      .then(() => true, () => false);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    if (landed && (await usdtHeld(wallet.address)) !== before) fail(`${label}: a second copy of the transaction took the stake again`);
    console.log(`${label}: the wallet's second copy of the transaction ${landed ? 'landed but took nothing' : 'was refused'}`);
  }
  return challenge.id;
}

/** The challenge's stake payout once it reaches `status`. */
const payout = (id, kind, status, timeoutMs = 240_000) =>
  until(
    `the ${kind} reaching ${status}`,
    async () => {
      const { data, error } = await supabase.from('solana_payouts').select('kind, status, signature, to_wallet, amount_cents').eq('challenge_id', id).eq('kind', kind);
      if (error) fail(error.message);
      if (data[0]?.status === 'failed') fail(`the ${kind} failed: ${data[0].signature}`);
      return data[0]?.status === status && data[0];
    },
    timeoutMs,
    5_000,
  );

const { error: signInError } = await supabase.auth.signInWithPassword(login);
if (signInError) fail(`signing in as ${login.email}: ${signInError.message}`);
console.log(`Wallet ${wallet.address}, ${escrow ? 'escrow' : 'treasury'} path, test USDT ${usdt.mint}`);

// A: cancelled on Day 1, so the stake comes back to the wallet. In escrow, also a wallet that fetched twice.
const a = await startPaid('A', escrow);
const paid = await usdtHeld(wallet.address);
const { error: cancelError } = await supabase.from('challenges').update({ outcome: 'cancelled' }).eq('id', a).is('outcome', null);
if (cancelError) fail(`A: cancelling: ${cancelError.message}`);
const returned = await payout(a, 'return', 'confirmed');
const back = (await usdtHeld(wallet.address)) - paid;
if (back !== baseUnits(STAKE_CENTS, usdt.decimals)) fail(`A: ${back} units came back, not the $10 stake`);
console.log(`A: the $10 stake came back to the wallet ${explorer('tx', returned.signature)}`);

// B: misses until the third ends it, so the stake goes to the charity.
const b = await startPaid('B');
for (let day = 0; day < 4; day++) {
  const { error } = await supabase.functions.invoke('ai-check', { body: { challengeId: b, nextDay: true } });
  if (error) fail(`B: the demo clock: ${error.message}`);
}
const { error: endError } = await supabase.from('challenges').update({ outcome: 'not_finished' }).eq('id', b).is('outcome', null);
if (endError) fail(`B: ending it not finished: ${endError.message}`);
if (escrow) {
  const given = await payout(b, 'donation', 'confirmed');
  const held = await usdtHeld(given.to_wallet);
  if (held < baseUnits(STAKE_CENTS, usdt.decimals)) fail(`B: the charity's vault holds ${held} units, less than the stake`);
  console.log(`B: the $10 stake went to the charity's vault ${explorer('address', given.to_wallet)} ${explorer('tx', given.signature)}`);
} else {
  const waiting = await payout(b, 'donation', 'due', 30_000);
  if (waiting.to_wallet) fail('B: a treasury donation has an address before Every.org’s endpoint exists');
  console.log('B: the donation waits in the treasury with no address, as it should until Every.org’s endpoint (decision 167)');
}
console.log('PASS');
