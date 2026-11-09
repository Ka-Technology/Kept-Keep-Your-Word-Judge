// Kept's devnet identity (T221, decision 178): the keys and the test token that solana-pay runs on.
// The old devnet keys were made on another machine and live only as write-only Supabase secrets, so
// this makes a fresh set, writes them into env/test.env (git-ignored), and prints only addresses.
//
//   node devnet.mjs keys      fee payer + treasury into env/test.env, the E2E wallet into env/devnet-wallet.json
//                             (refuses to replace a key already there; --force replaces it)
//   node devnet.mjs airdrop [address]   1 devnet SOL to the address (default: the fee payer). When the
//                             faucet refuses, it says so: fund the address at faucet.solana.com instead
//   node devnet.mjs mint      Kept's test USDT: a new 6-decimal mint, the fee payer its mint authority
//   node devnet.mjs deployer  the escrow program's deployer and upgrade authority, into env/devnet-deployer.json
//                             (the Solana CLI in WSL reads it with --keypair; never replaced once made)
//   node devnet.mjs balance   the SOL of the fee payer, the treasury, the E2E wallet and the deployer
//
// Uses this folder's @solana packages (npm install here first) and the token instructions written by
// hand, as solana.ts does. Devnet only: it refuses any other cluster.

import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { address, getAddressDecoder, getAddressEncoder } from '@solana/addresses';
import { pipe } from '@solana/functional';
import { AccountRole } from '@solana/instructions';
import { createSolanaRpc } from '@solana/rpc';
import { createKeyPairSignerFromBytes, setTransactionMessageFeePayerSigner, signTransactionMessageWithSigners } from '@solana/signers';
import { appendTransactionMessageInstructions, createTransactionMessage, setTransactionMessageLifetimeUsingBlockhash } from '@solana/transaction-messages';
import { getBase64EncodedWireTransaction, getSignatureFromTransaction } from '@solana/transactions';

const ENV_FILE = new URL('../../env/test.env', import.meta.url);
const WALLET_FILE = new URL('../../env/devnet-wallet.json', import.meta.url);
const DEPLOYER_FILE = new URL('../../env/devnet-deployer.json', import.meta.url);
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const MINT_SIZE = 82;

/** A new keypair as Solana's CLI writes it: the 32-byte seed then the 32-byte public key, 64 numbers. */
function newKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url');
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  return { bytes: [...seed, ...pub], address: getAddressDecoder().decode(pub) };
}

/** The env file's NAME=value pairs that are one line (multi-line values, like the Apple key, are left alone). */
function readEnv() {
  const text = readFileSync(ENV_FILE, 'utf8');
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) values[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return { text, values };
}

/** Sets each NAME=value on its own line, replacing that line or adding it at the end, keeping the file's line endings. */
function writeEnv(entries) {
  const { text } = readEnv();
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  for (const [name, value] of Object.entries(entries)) {
    const at = lines.findIndex((l) => l.startsWith(`${name}=`));
    if (at >= 0) lines[at] = `${name}=${value}`;
    else lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `${name}=${value}`);
  }
  writeFileSync(ENV_FILE, lines.join(eol));
}

function env() {
  const { values } = readEnv();
  if ((values.SOLANA_CLUSTER || 'devnet') !== 'devnet') throw new Error('env/test.env is not on devnet; this script is devnet only.');
  return { values, rpc: createSolanaRpc(values.SOLANA_RPC_URL || 'https://api.devnet.solana.com') };
}

/** Waits until the transaction is confirmed (a supermajority has voted on it), or throws after a minute. */
async function confirmed(rpc, signature) {
  for (let i = 0; i < 60; i++) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const s = value[0];
    if (s?.err) throw new Error(`transaction failed: ${JSON.stringify(s.err)}`);
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`not confirmed after 60 s: ${signature}`);
}

async function keys(force) {
  const { values } = readEnv();
  const taken = ['SOLANA_FEE_PAYER_KEY', 'SOLANA_TREASURY_KEY'].filter((n) => values[n]);
  if ((taken.length || existsSync(WALLET_FILE)) && !force) {
    throw new Error(`Keys already there (${[...taken, ...(existsSync(WALLET_FILE) ? ['env/devnet-wallet.json'] : [])].join(', ')}). Pass --force to replace them.`);
  }
  const feePayer = newKeypair();
  const treasury = newKeypair();
  const wallet = newKeypair();
  writeEnv({
    SOLANA_FEE_PAYER_KEY: JSON.stringify(feePayer.bytes),
    SOLANA_TREASURY: treasury.address,
    SOLANA_TREASURY_KEY: JSON.stringify(treasury.bytes),
  });
  writeFileSync(WALLET_FILE, JSON.stringify(wallet.bytes) + '\n');
  console.log(`Fee payer ${feePayer.address}\nTreasury  ${treasury.address}\nE2E wallet ${wallet.address}\nKeys written to env/test.env and env/devnet-wallet.json (git-ignored).`);
}

async function feePayerSigner(values) {
  if (!values.SOLANA_FEE_PAYER_KEY) throw new Error('No SOLANA_FEE_PAYER_KEY in env/test.env: run `node devnet.mjs keys` first.');
  return createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(values.SOLANA_FEE_PAYER_KEY)));
}

async function airdrop(to) {
  const { values, rpc } = env();
  const target = to ?? (await feePayerSigner(values)).address;
  try {
    const sig = await rpc.requestAirdrop(address(target), 1_000_000_000n).send();
    await confirmed(rpc, sig);
    console.log(`1 SOL airdropped to ${target}`);
  } catch (e) {
    console.log(`The devnet faucet refused (${String(e?.message ?? e).split('\n')[0]}). Fund ${target} at https://faucet.solana.com instead.`);
    process.exitCode = 2;
  }
}

async function mint() {
  const { values, rpc } = env();
  const payer = await feePayerSigner(values);
  const fresh = newKeypair();
  const mintSigner = await createKeyPairSignerFromBytes(new Uint8Array(fresh.bytes));
  const encoder = getAddressEncoder();
  const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(MINT_SIZE)).send();
  // System program CreateAccount: instruction 0, lamports, space, owner.
  const create = new Uint8Array(52);
  const view = new DataView(create.buffer);
  view.setUint32(0, 0, true);
  view.setBigUint64(4, BigInt(rent), true);
  view.setBigUint64(12, BigInt(MINT_SIZE), true);
  create.set(encoder.encode(address(TOKEN_PROGRAM)), 20);
  // Token InitializeMint2: instruction 20, decimals, the mint authority, then no freeze authority.
  const init = new Uint8Array(35);
  init[0] = 20;
  init[1] = 6;
  init.set(encoder.encode(payer.address), 2);
  init[34] = 0;
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          {
            programAddress: address(SYSTEM_PROGRAM),
            accounts: [
              { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
              { address: mintSigner.address, role: AccountRole.WRITABLE_SIGNER, signer: mintSigner },
            ],
            data: create,
          },
          { programAddress: address(TOKEN_PROGRAM), accounts: [{ address: mintSigner.address, role: AccountRole.WRITABLE }], data: init },
        ],
        m,
      ),
  );
  const signed = await signTransactionMessageWithSigners(message);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
  await confirmed(rpc, getSignatureFromTransaction(signed));
  console.log(`Kept's test USDT mint: ${mintSigner.address} (6 decimals, mint authority ${payer.address}). Put it in TOKENS.devnet.USDT in supabase/functions/solana-pay/solana.ts.`);
}

async function deployer() {
  // The upgrade authority of the program on devnet: losing it means deploying a new program id.
  if (existsSync(DEPLOYER_FILE)) throw new Error('env/devnet-deployer.json already exists; it is never replaced.');
  const key = newKeypair();
  writeFileSync(DEPLOYER_FILE, JSON.stringify(key.bytes) + '\n');
  console.log(`Deployer ${key.address} written to env/devnet-deployer.json (git-ignored).`);
}

const fileAddress = async (file) => (await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(file, 'utf8'))))).address;

async function balance() {
  const { values, rpc } = env();
  const named = { 'fee payer': values.SOLANA_FEE_PAYER_KEY && (await feePayerSigner(values)).address, treasury: values.SOLANA_TREASURY };
  if (existsSync(WALLET_FILE)) named['E2E wallet'] = await fileAddress(WALLET_FILE);
  if (existsSync(DEPLOYER_FILE)) named.deployer = await fileAddress(DEPLOYER_FILE);
  for (const [name, who] of Object.entries(named)) {
    if (!who) continue;
    const { value } = await rpc.getBalance(address(who)).send();
    console.log(`${name.padEnd(10)} ${who}  ${(Number(value) / 1e9).toFixed(4)} SOL`);
  }
}

const [command, arg] = process.argv.slice(2);
const run = { keys: () => keys(process.argv.includes('--force')), airdrop: () => airdrop(arg), mint, deployer, balance }[command];
if (!run) {
  console.error('Usage: node devnet.mjs <keys [--force] | airdrop [address] | mint | deployer | balance>');
  process.exit(1);
}
run().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
