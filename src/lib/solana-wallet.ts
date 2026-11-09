// What's in the user's own Solana wallet, shown in Wallet. A wallet's balance is public on chain, so reading it takes
// only its address and no key, signature or wallet SDK: the wallet that last paid a stake (solana_payments.payer), or
// one the user pastes, which stays on this phone. Kept only reads; only the wallet can move anything.
// ponytail: the public devnet RPC, from the phone. Mainnet (T172) needs its mints and a paid RPC, and the mint list
// in solana-pay/solana.ts has the same three (tested).

import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';

export const MINTS = {
  USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  USDT: 'C9RNqSLwZ6HN2DKin9ni18Jh9SaHZMsywVHajETZ8k6T',
  PYUSD: 'CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM',
} as const;

const RPC = 'https://api.devnet.solana.com';
// USDC and USDT are classic SPL tokens; PYUSD is Token-2022.
const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];

type TokenAccount = { account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmountString: string } } } } } };

/** The address in pasted text, or null: 32 to 44 base58 characters, which is what a Solana address is. */
export function validWalletAddress(text: string): string | null {
  const address = text.trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? address : null;
}

/** "7xKX…gAsU". */
export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Every token Kept takes, in order, each with what the wallet holds of it; other tokens aren't Kept's to list. */
export function balancesFrom(accounts: TokenAccount[]): { token: string; amount: string }[] {
  return Object.entries(MINTS).map(([token, mint]) => {
    const held = accounts.filter((a) => a.account.data.parsed.info.mint === mint);
    const sum = held.reduce((total, a) => total + Number(a.account.data.parsed.info.tokenAmount.uiAmountString), 0);
    return { token, amount: String(Number(sum.toFixed(6))) };
  });
}

/** Reads the wallet's balances from Solana. Throws when the network or the RPC can't answer. */
export async function walletBalances(address: string): Promise<{ token: string; amount: string }[]> {
  const answers = await Promise.all(
    TOKEN_PROGRAMS.map(async (programId) => {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [address, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }] }),
      });
      const answer = await res.json();
      if (!answer.result) throw new Error('rpc_failed');
      return answer.result.value as TokenAccount[];
    }),
  );
  return balancesFrom(answers.flat());
}

const key = (userId: string) => `kept.solanaWallet.${userId}`;

/** The wallet to read: the one pasted on this phone, or else the one that last paid; null when Kept knows of none. */
export async function knownWallet(userId: string): Promise<string | null> {
  const pasted = await AsyncStorage.getItem(key(userId)).catch(() => null);
  if (pasted) return pasted;
  const { data, error } = await supabase.from('solana_payments').select('payer').not('payer', 'is', null).order('confirmed_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data?.payer ?? null;
}

/** Remembers a pasted wallet on this phone. A failed save only means it's asked for again. */
export async function saveWallet(userId: string, address: string): Promise<void> {
  await AsyncStorage.setItem(key(userId), address).catch(() => {});
}
