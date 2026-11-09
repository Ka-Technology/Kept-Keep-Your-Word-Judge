import { TOKENS } from '../../supabase/functions/solana-pay/solana';
import { balancesFrom, MINTS, shortAddress, validWalletAddress } from './solana-wallet';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('./supabase', () => ({ supabase: {} }));

const account = (mint: string, ui: string) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { uiAmountString: ui } } } } } });

describe('validWalletAddress', () => {
  it('takes a Solana address, spaces around it trimmed', () => {
    expect(validWalletAddress(' 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU\n')).toBe('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
  });

  it('refuses anything else, like a 6-digit code or an Ethereum address', () => {
    expect(validWalletAddress('395033')).toBeNull();
    expect(validWalletAddress('0x742d35Cc6634C0532925a3b844Bc454e4438f44e')).toBeNull();
    expect(validWalletAddress('')).toBeNull();
  });
});

describe('shortAddress', () => {
  it('keeps the two ends people check', () => {
    expect(shortAddress('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')).toBe('7xKX…gAsU');
  });
});

describe('balancesFrom', () => {
  it('lists every token Kept takes, with zero for one the wallet has none of', () => {
    expect(balancesFrom([account(MINTS.USDC, '12.5')])).toEqual([
      { token: 'USDC', amount: '12.5' },
      { token: 'USDT', amount: '0' },
      { token: 'PYUSD', amount: '0' },
    ]);
  });

  it('ignores tokens Kept does not take', () => {
    expect(balancesFrom([account('SomeOtherMint', '99')]).every((b) => b.amount === '0')).toBe(true);
  });

  it('adds up several accounts of one token', () => {
    expect(balancesFrom([account(MINTS.USDT, '1.25'), account(MINTS.USDT, '2.5')])[1]).toEqual({ token: 'USDT', amount: '3.75' });
  });
});

describe('MINTS', () => {
  it('matches the mints solana-pay charges in', () => {
    for (const [symbol, token] of Object.entries(TOKENS.devnet)) expect(MINTS[symbol as keyof typeof MINTS]).toBe(token.mint);
  });
});
