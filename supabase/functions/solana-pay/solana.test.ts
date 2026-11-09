// Unit tests for solana.ts: how solana-pay prices a stake in tokens and recognizes its payment on chain. Run with the app's jest.
import { readFileSync } from 'node:fs';

import { serviceFeeCents } from '../../../src/lib/challenge-rules';
import { SOLANA_TOKENS } from '../../../src/lib/challenges';
import {
  baseUnits,
  CREATE_IDEMPOTENT_DATA,
  decodeEscrow,
  ESCROW_ACCOUNT_DISCRIMINATOR,
  ESCROW_LOCKED,
  ESCROW_SIZE,
  escrowValid,
  expired,
  KEPT_TEST_TOKEN,
  LOCK_DISCRIMINATOR,
  lockData,
  lockedBy,
  mintToCheckedData,
  paidBy,
  reclaimAfter,
  SETTLE_DISCRIMINATOR,
  settleData,
  uuidBytes,
  payoutStep,
  shortfall,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  TOKENS,
  topUp,
  transferCheckedData,
  validAddress,
  type ParsedTransaction,
} from './solana';

const TREASURY = '2jUM9pPUJcFKj3z6dKsdAExGcXD9yUfUC34LnPHa1z8t';
const PAYER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const REFERENCE = 'BsttuPGGQvE6cWx1jJ53sSyTcedvufWNd8obHYtrkwJD';
const USDC = TOKENS.devnet.USDC.mint;

/** A finalized transfer of `amount` of `mint` from PAYER to TREASURY, as getTransaction (jsonParsed) answers it. */
function transfer({ amount = '27250000', mint = USDC, err = null as unknown, keys = [PAYER, TREASURY, REFERENCE], to = TREASURY } = {}): ParsedTransaction {
  const balance = (accountIndex: number, owner: string, value: string) => ({ accountIndex, mint, owner, uiTokenAmount: { amount: value } });
  return {
    meta: {
      err,
      preTokenBalances: [balance(1, PAYER, '100000000'), balance(2, to, '0')],
      postTokenBalances: [balance(1, PAYER, String(100000000n - BigInt(amount))), balance(2, to, amount)],
    },
    transaction: { message: { accountKeys: keys.map((pubkey) => ({ pubkey })) } },
  };
}

const want = { reference: REFERENCE, treasury: TREASURY, mint: USDC, amount: 27250000n };

describe('baseUnits (dollars as a 6-decimal stablecoin’s smallest units)', () => {
  it('turns $25 + $2.25 into 27.25 tokens', () => {
    expect(baseUnits(2500 + serviceFeeCents(2500), 6)).toBe(27250000n);
  });
});

describe('the token instructions written by hand (the token programs’ own layouts)', () => {
  it('lays out TransferChecked as instruction 12, the amount little-endian, then the decimals', () => {
    expect([...transferCheckedData(27250000n, 6)]).toEqual([12, 0x50, 0xcd, 0x9f, 0x01, 0, 0, 0, 0, 6]);
  });

  it('creates an account idempotently with instruction 1', () => {
    expect([...CREATE_IDEMPOTENT_DATA]).toEqual([1]);
  });

  it('lays out MintToChecked as instruction 14, the amount little-endian, then the decimals', () => {
    expect([...mintToCheckedData(27250000n, 6)]).toEqual([14, 0x50, 0xcd, 0x9f, 0x01, 0, 0, 0, 0, 6]);
  });
});

describe('topUp (T222: on devnet, Kept mints its own test token into a short wallet, so a judge needs no faucet)', () => {
  const devnet = { cluster: 'devnet', symbol: KEPT_TEST_TOKEN, firstRequest: true };

  it('mints exactly what the stake and fee are short of', () => {
    expect(topUp(8200000n, 27250000n, devnet)).toBe(19050000n);
    expect(topUp(0n, 11800000n, devnet)).toBe(11800000n);
  });

  it('mints nothing for a wallet that already holds enough', () => {
    expect(topUp(27250000n, 27250000n, devnet)).toBeNull();
    expect(topUp(30000000n, 27250000n, devnet)).toBeNull();
  });

  it('only for Kept’s own test token: Circle’s USDC and Paxos’s PYUSD are theirs to mint', () => {
    expect(topUp(0n, 11800000n, { ...devnet, symbol: 'USDC' })).toBeNull();
    expect(topUp(0n, 11800000n, { ...devnet, symbol: 'PYUSD' })).toBeNull();
  });

  it('only on devnet, never on mainnet', () => {
    expect(topUp(0n, 11800000n, { ...devnet, cluster: 'mainnet' })).toBeNull();
  });

  it('only on a payment’s first fetch, so the signed-out endpoint can’t be asked again and again', () => {
    expect(topUp(0n, 11800000n, { ...devnet, firstRequest: false })).toBeNull();
  });

  it('is a classic SPL token Kept can mint, on the devnet list', () => {
    expect(TOKENS.devnet[KEPT_TEST_TOKEN].program).toBe(TOKEN_PROGRAM);
  });
});

describe('paidBy (is this finalized transaction the payment, and from which wallet?)', () => {
  it('finds the payer of the exact amount to the treasury, carrying the reference', () => {
    expect(paidBy(transfer(), want)).toBe(PAYER);
  });

  it('ignores a failed transaction', () => {
    expect(paidBy(transfer({ err: { InstructionError: [1, 'Custom'] } }), want)).toBeNull();
  });

  it('ignores a transfer without the reference key', () => {
    expect(paidBy(transfer({ keys: [PAYER, TREASURY] }), want)).toBeNull();
  });

  it('ignores a short amount, another token, or another destination', () => {
    expect(paidBy(transfer({ amount: '27249999' }), want)).toBeNull();
    expect(paidBy(transfer({ mint: TOKENS.devnet.PYUSD.mint }), want)).toBeNull();
    expect(paidBy(transfer({ to: PAYER.replace('7', '8') }), want)).toBeNull();
  });
});

describe('shortfall (a wallet without enough of the token is told so, not left to fail)', () => {
  it('says what the wallet holds and what is needed', () => {
    expect(shortfall(8200000n, 27250000n, 6, 'USDC')).toBe(
      'This wallet has 8.20 USDC, and the stake and fee need 27.25 USDC. Add USDC on Solana to this wallet, or pick another token in Kept.',
    );
  });

  it('is null when the wallet holds enough, exactly or more', () => {
    expect(shortfall(27250000n, 27250000n, 6, 'USDC')).toBeNull();
    expect(shortfall(88200000n, 11800000n, 6, 'USDT')).toBeNull();
  });
});

describe('expired (when an unpaid challenge is removed)', () => {
  const signed = '2026-10-26T12:00:00Z';
  const at = (minutes: number) => new Date(Date.parse(signed) + minutes * 60_000);

  it('waits 15 minutes after signing', () => {
    expect(expired({ created_at: signed, requested_at: null }, at(14))).toBe(false);
    expect(expired({ created_at: signed, requested_at: null }, at(15))).toBe(true);
  });

  it('waits 3 minutes after the wallet last asked, so a late transfer can still land', () => {
    expect(expired({ created_at: signed, requested_at: at(14).toISOString() }, at(16))).toBe(false);
    expect(expired({ created_at: signed, requested_at: at(14).toISOString() }, at(17))).toBe(true);
  });
});

describe('the token list', () => {
  it('matches the app’s list and the database’s check (migration 0055)', () => {
    expect(Object.keys(TOKENS.devnet).sort()).toEqual([...SOLANA_TOKENS].sort());
    const migration = readFileSync(`${__dirname}/../../migrations/0055_solana_payments.sql`, 'utf8');
    expect(migration).toContain(`pay_token in (${SOLANA_TOKENS.map((t) => `'${t}'`).join(', ')})`);
  });

  it('uses dollar stablecoins with valid mints, PYUSD on Token-2022', () => {
    for (const token of Object.values(TOKENS.devnet)) {
      expect(validAddress(token.mint)).toBe(true);
      expect(token.decimals).toBe(6);
    }
    expect(TOKENS.devnet.PYUSD.program).toBe(TOKEN_2022_PROGRAM);
  });
});

describe('the escrow program’s instructions and account (T230), as its IDL has them', () => {
  const idl = JSON.parse(readFileSync(`${__dirname}/../../../solana/kept_escrow.json`, 'utf8'));
  const ix = (name: string) => idl.instructions.find((i: { name: string }) => i.name === name);

  it('uses the IDL’s discriminators and argument order', () => {
    expect([...LOCK_DISCRIMINATOR]).toEqual(ix('lock').discriminator);
    expect([...SETTLE_DISCRIMINATOR]).toEqual(ix('settle').discriminator);
    expect([...ESCROW_ACCOUNT_DISCRIMINATOR]).toEqual(idl.accounts.find((a: { name: string }) => a.name === 'Escrow').discriminator);
    expect(ix('lock').args.map((a: { name: string }) => a.name)).toEqual(['challenge_id', 'amount', 'charity', 'reclaim_after']);
    expect(ix('lock').accounts.map((a: { name: string }) => a.name)).toEqual(['kept', 'challenger', 'mint', 'challenger_token', 'escrow', 'vault', 'token_program', 'system_program']);
    expect(ix('settle').accounts.map((a: { name: string }) => a.name)).toEqual(['kept', 'escrow', 'mint', 'vault', 'destination', 'token_program']);
    const fields = idl.types.find((t: { name: string }) => t.name === 'Escrow').type.fields.map((f: { name: string }) => f.name);
    expect(fields).toEqual(['challenge_id', 'challenger', 'mint', 'amount', 'charity', 'reclaim_after', 'state', 'bump']);
  });

  it('turns a challenge’s UUID into its 16 bytes', () => {
    expect([...uuidBytes('00112233-4455-6677-8899-aabbccddeeff')]).toEqual([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  });

  it('lays out lock as its discriminator, the id, the amount, the charity hash and the reclaim time, little-endian', () => {
    const id = new Uint8Array(16).fill(1);
    const charity = new Uint8Array(32).fill(2);
    const data = lockData(id, 10000000n, charity, 1767225600n);
    expect(data.length).toBe(8 + 16 + 8 + 32 + 8);
    expect([...data.slice(0, 8)]).toEqual([...LOCK_DISCRIMINATOR]);
    expect([...data.slice(8, 24)]).toEqual([...id]);
    expect([...data.slice(24, 32)]).toEqual([0x80, 0x96, 0x98, 0, 0, 0, 0, 0]);
    expect([...data.slice(32, 64)]).toEqual([...charity]);
    expect(new DataView(data.buffer).getBigInt64(64, true)).toBe(1767225600n);
  });

  it('lays out settle as its discriminator and the refund flag', () => {
    expect([...settleData(true)]).toEqual([...SETTLE_DISCRIMINATOR, 1]);
    expect([...settleData(false)]).toEqual([...SETTLE_DISCRIMINATOR, 0]);
  });

  /** An Escrow account's bytes, as the program writes them. */
  function escrowBytes({ disc = ESCROW_ACCOUNT_DISCRIMINATOR, state = ESCROW_LOCKED, amount = 10000000n } = {}) {
    const data = new Uint8Array(ESCROW_SIZE);
    const view = new DataView(data.buffer);
    data.set(disc, 0);
    data.fill(1, 8, 24); // challenge id
    data.fill(3, 24, 56); // challenger
    data.fill(4, 56, 88); // mint
    view.setBigUint64(88, amount, true);
    data.fill(5, 96, 128); // charity hash
    view.setBigInt64(128, 1767225600n, true);
    data[136] = state;
    data[137] = 254;
    return data;
  }

  it('decodes an escrow account, and nothing else', () => {
    const e = decodeEscrow(escrowBytes())!;
    expect([...e.challengeId]).toEqual(new Array(16).fill(1));
    expect([...e.challenger]).toEqual(new Array(32).fill(3));
    expect([...e.mint]).toEqual(new Array(32).fill(4));
    expect(e.amount).toBe(10000000n);
    expect([...e.charity]).toEqual(new Array(32).fill(5));
    expect(e.reclaimAfter).toBe(1767225600n);
    expect(e.state).toBe(ESCROW_LOCKED);
    expect(decodeEscrow(escrowBytes({ disc: new Uint8Array(8) }))).toBeNull();
    expect(decodeEscrow(escrowBytes().slice(0, ESCROW_SIZE - 1))).toBeNull();
  });

  it('accepts only a locked escrow of exactly the stake, the token and the wallet that paid', () => {
    const want = { challenger: new Uint8Array(32).fill(3), mint: new Uint8Array(32).fill(4), amount: 10000000n };
    expect(escrowValid(decodeEscrow(escrowBytes())!, want)).toBe(true);
    expect(escrowValid(decodeEscrow(escrowBytes({ state: 1 }))!, want)).toBe(false);
    expect(escrowValid(decodeEscrow(escrowBytes({ amount: 9999999n }))!, want)).toBe(false);
    expect(escrowValid(decodeEscrow(escrowBytes())!, { ...want, mint: new Uint8Array(32).fill(9) })).toBe(false);
    expect(escrowValid(decodeEscrow(escrowBytes())!, { ...want, challenger: new Uint8Array(32).fill(9) })).toBe(false);
  });

  it('sets the reclaim time past the challenge’s longest end: Day 1 tomorrow, its days, five possible extra days, 30 days’ grace', () => {
    expect(reclaimAfter('2026-11-03T00:00:00Z', 28)).toBe(BigInt(Date.parse('2026-11-03T00:00:00Z') / 1000 + (1 + 28 + 5 + 30) * 86400));
  });
});

describe('lockedBy (is this transaction the escrowed stake and Kept’s fee, and from which wallet?)', () => {
  const ESCROW = '9PAq4r5P3M19C8hJRaiFXmWQJtL4XfRjxDQwxmPFcMrJ';
  /** A lock: the payer's tokens split between the escrow's vault (the stake) and the treasury (the fee). */
  function lock({ stake = '10000000', fee = '1800000', err = null as unknown, keys = [PAYER, TREASURY, ESCROW, REFERENCE] } = {}): ParsedTransaction {
    const balance = (accountIndex: number, owner: string, value: string) => ({ accountIndex, mint: USDC, owner, uiTokenAmount: { amount: value } });
    return {
      meta: {
        err,
        preTokenBalances: [balance(1, PAYER, '100000000'), balance(2, TREASURY, '0'), balance(3, ESCROW, '0')],
        postTokenBalances: [balance(1, PAYER, String(100000000n - BigInt(stake) - BigInt(fee))), balance(2, TREASURY, fee), balance(3, ESCROW, stake)],
      },
      transaction: { message: { accountKeys: keys.map((pubkey) => ({ pubkey })) } },
    };
  }
  const want = { reference: REFERENCE, escrow: ESCROW, treasury: TREASURY, mint: USDC, stake: 10000000n, fee: 1800000n };

  it('finds the wallet that paid the stake into the escrow and the fee to the treasury', () => {
    expect(lockedBy(lock(), want)).toBe(PAYER);
  });

  it('ignores a failed transaction, one without the reference, or one that splits it differently', () => {
    expect(lockedBy(lock({ err: { InstructionError: [3, 'Custom'] } }), want)).toBeNull();
    expect(lockedBy(lock({ keys: [PAYER, TREASURY, ESCROW] }), want)).toBeNull();
    expect(lockedBy(lock({ stake: '9999999', fee: '1800001' }), want)).toBeNull();
    expect(lockedBy(lock({ stake: '0', fee: '11800000' }), want)).toBeNull();
  });
});

describe('payoutStep (T170: a sent payout lands once, or is sent again only once it never can)', () => {
  const landed = { err: null, confirmationStatus: 'confirmed' };

  it('is confirmed once the cluster has voted on it, and failed if it landed with an error', () => {
    expect(payoutStep(landed, 100n, 150n)).toBe('confirmed');
    expect(payoutStep({ err: null, confirmationStatus: 'finalized' }, 200n, 150n)).toBe('confirmed');
    expect(payoutStep({ err: { InstructionError: [1, 'Custom'] }, confirmationStatus: 'confirmed' }, 100n, 150n)).toBe('failed');
  });

  it('waits while it’s only processed, error or not', () => {
    expect(payoutStep({ err: null, confirmationStatus: 'processed' }, 200n, 150n)).toBe('wait');
    expect(payoutStep({ err: 'boom', confirmationStatus: 'processed' }, 200n, 150n)).toBe('wait');
  });

  it('waits while its blockhash is valid, and expires only after, when it can never land', () => {
    expect(payoutStep(null, 150n, 150n)).toBe('wait');
    expect(payoutStep(null, 151n, 150n)).toBe('expired');
  });
});
