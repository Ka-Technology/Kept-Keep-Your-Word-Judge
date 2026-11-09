# Kept

A mobile habit-commitment app: challengers stake money on a habit and friends back them with pledges. Finish and your stake comes back and the pledges go to your charity; don't finish and your stake goes to that charity. Free trackers let anyone keep a habit with no money at all.

**About this copy:** this repository is the code of build 5 (the build on TestFlight), published as one commit for the hackathon's judges. Kept's docs and website are left out. It is not open source: see [License](#license).

## For judges

Kept is an iPhone app (Expo / React Native, TypeScript) on a Supabase backend. **On Solana, the promise holds the money.** A crypto stake is locked in Kept's own escrow program, in an account made for that one challenge. The program enforces Kept's money rule on chain:

- the stake can only go back to the challenger (finished, or cancelled on Day 1), or to the charity named when they signed (not finished);
- Kept's server decides which, but it can't send the money anywhere else;
- if Kept never decides, anyone can send the stake back to the challenger once the challenge's time is up.

Paying takes one tap in the wallet. A Solana Pay link opens Phantom, and Kept pays every network fee, so nobody needs SOL. On devnet, Kept tops up its own test USDT, so there's no faucet either. Everything runs on **Solana devnet** with test tokens; no real money moves anywhere.

### How Solana powers Kept

- **The escrow program** `kept-escrow` (Anchor 1.2.2, [`4mN4zLWuZWQUbKR97DCr5vqWAXPHxuKQeQC8tC8nYfC1`](https://explorer.solana.com/address/4mN4zLWuZWQUbKR97DCr5vqWAXPHxuKQeQC8tC8nYfC1?cluster=devnet) on devnet) has three instructions:
  - `lock` moves the stake into the challenge's escrow. Kept's key co-signs, so nobody can open or block a challenge's escrow first.
  - `settle` sends the whole escrow either back to the challenger or to the charity's account. That account is a program address that nobody holds a key for. The escrow keeps its final state, so it pays out once.
  - `reclaim`, after the challenge's length plus a grace period, sends an unsettled stake back to the challenger. Anyone can call it.
- **Solana Pay transaction requests.** The app opens a `solana:` link. Phantom (or Solflare) fetches the transaction from Kept's server, the user approves, and the wallet sends it. The app has no wallet SDK and never sees a key, and it works on iOS.
- **Gasless.** Kept's fee payer pays the network fees and the rent for new accounts. Kept's service fee goes to its treasury in the same transaction as the stake.
- **Checked on chain.** A challenge starts only after the server finds the transaction and reads the escrow account: the right amount, token and wallet, and still locked. Each payout is recorded once and confirmed by its signature. The app links the escrow and every payout to Solana's explorer.
- **Tested both ways.**
  - The program has nine [LiteSVM tests](solana/programs/kept-escrow/tests/escrow.rs).
  - [`e2e.mjs`](supabase/solana-pay-build/e2e.mjs) plays a wallet against the live devnet setup.
  - A run on 2026-11-03:
    - [a stake locked](https://explorer.solana.com/tx/5WW8yZ9RkPAj9jXR6DzEXKVpNsz7hFFFyLTJ1CjQAn3VvJYLGMTK9Vg6MXvGRZgX41a19Rvoo436iLNQGPKfAfWM?cluster=devnet)
    - [settled back to the wallet](https://explorer.solana.com/tx/3XAaX7HAS4fz3StZnKHLitWeZ4oxVHG54WaYb6KB2BM3k4GXCtWqq8pteMtRdmDZy32RSYQjF6e9XHjLWaztc9XK?cluster=devnet) after a Day 1 cancel
    - another [settled to the charity's account](https://explorer.solana.com/tx/58Z9f8YmtqSTpa41hxiLBDRsyt8oHp5vKpWnEg4WbxeZBg1BvYXhjmyzH7ZoaVZ9iwtrHcYrLsSEm62nMDxokM6Z?cluster=devnet) after missed days
    - the wallet's second copy of a payment was refused, and took nothing
- **Still on Kept's treasury on devnet:** pledges, and stakes in PYUSD, a Token-2022 token. Mainnet waits for counsel and an audit of the program.

### What is real and what is test

| Part | In this build |
|---|---|
| Solana (stakes in Kept's escrow program, payouts) | Real transactions on **devnet**. Wallet: Phantom or Solflare. Test USDT is topped up by Kept; Circle's devnet USDC also works |
| Stripe (card stakes and pledges) | **Test mode**. Use card `4242 4242 4242 4242`, any future date, any CVC |
| Every.org (charity search) | Live nonprofit search. Picking a charity only records it; nothing is donated in this build |
| Anthropic Claude | Checks check-in photos on the server, only if the user allowed it at sign-up. Nothing to set up |
| Supabase | Kept's **test** project (no real users) |

### 1. Get the app

Kept needs a native build (Face ID, Stripe, Google sign-in and notifications don't run in Expo Go), and builds are signed to Ka Technology's Apple account, so install the prebuilt one:

- iPhone: install through TestFlight: **https://testflight.apple.com/join/PqvG2rEe**

### 2. Sign in

Use the demo accounts below. They are already confirmed, so signing in needs only the email and password: nothing is emailed, and none of these addresses has a real inbox. (A brand-new sign-up needs a US state, a date of birth showing 18+, and a 6-digit code emailed to the address you enter, so skip it.)

| | Email | Password | What it shows |
|---|---|---|---|
| **Reviewer** (start here) | `reviewer@habitkept.com` | `XESvIA8faZ820lgdaA1!` | Two friends (Frankie and Jordan) and two pending requests (Maya and Sam). No challenge yet: you start your own |
| Frankie | `friend@habitkept.com` | `1thuPR4afI90717MaA1!` | Your friend. Sign in as Frankie to see the Reviewer's public challenge and back it with a pledge |
| Jordan | `jordan@habitkept.com` | `ylUAPQk0eG8PhJs7aA1!` | Your friend. Another account to see Kept from a friend's side |
| Maya | `maya@habitkept.com` | `T3OGz2rKNderC8INaA1!` | Asked to be your friend: accept her in the Friends tab |
| Sam | `sam@habitkept.com` | `iCA6xnQaROt1GARHaA1!` | You asked Sam; he hasn't answered |

Sign in as Reviewer to see Kept from the challenger's side. Sign out and sign in as Frankie, Jordan, Maya or Sam to see the same relationships from theirs. The demo accounts have no challenges on purpose: nobody checks in for them, so a challenge left running would fail after a few days. Start your own as Reviewer.

### 3. A ten-minute tour

**A. Without a wallet (2 min).** Open the Friends tab as Reviewer: accept Maya's request, and see that Sam is waiting. Start a challenge (Card, with Stripe's test card above; the stake step is explained in B). Open it and tap **Next day (demo)** to move the demo clock forward: a 28-day challenge can be taken to its end in minutes.

**B. A Solana stake in the escrow (5 min, no faucet, no SOL).**

1. Install **Phantom** (or Solflare) on the same iPhone and create a wallet. In Phantom: *Settings → Developer Settings → Testnet Mode*, then choose **Solana Devnet** ([Phantom's guide](https://docs.phantom.com/developer-powertools/testnet-mode.md)). The wallet can stay empty.
2. In Kept, start a new challenge: pick a habit, length and charity. On the stake step, choose **Crypto**. The token is **USDT**, Kept's devnet test token, which Kept tops up in your wallet. Stake $10 and sign the promise.
3. Kept opens Phantom on the payment (a Solana Pay link): your $10 stake, locked on Solana, and Kept's $1.80 fee. Approve it, then switch back to Kept. The screen says *Waiting for your wallet* until the payment is found on chain, then the challenge starts.
4. The challenge screen says your stake is locked on Solana and can only go back to you or to your charity. **See it on Solana** opens the escrow account on the explorer.
5. Either:
   - cancel it on Day 1 (the stake comes back to your wallet), or
   - tap **Next day (demo)** past three missed days: the challenge ends not finished, and the stake goes to the charity's account.

   The results screen links the program's `settle` transaction.

Prefer Circle's own test USDC? Pick **USDC** on the stake step, after getting some from [faucet.circle.com](https://faucet.circle.com) (Solana, Devnet).

If the wallet gives you trouble, the app works without it: the **Card** option uses Stripe's test card above.

**C. A pledge.** As Reviewer, start a challenge and make it **public**. Sign out and sign in as Frankie (a friend), open the Reviewer's challenge and back it with a pledge. The Reviewer's challenge screen then shows the pledge.

### 4. Where the Solana code is

| What | Where |
|---|---|
| The escrow program: `lock`, `settle`, `reclaim` | `solana/programs/kept-escrow/src/lib.rs`, its tests in `solana/programs/kept-escrow/tests/escrow.rs`, its IDL in `solana/kept_escrow.json` |
| The Solana Pay link and wallet handoff | `src/lib/solana-pay.ts`, `src/app/challenge/[id]/pay.tsx` |
| Stake and token choice; the escrow on the challenge screen | `src/app/challenge/new/stake.tsx`, `src/app/challenge/[id].tsx` |
| The server side: building the lock, checking it on chain, settling it, the top-up | `supabase/functions/solana-pay/` (`index.ts`, `solana.ts`; `bundle.js` is built from them) |
| The ledger: payments, payouts, the escrow's accounts | `supabase/migrations/0055_solana_payments.sql`, `0072_solana_payouts.sql`, `0084_solana_escrow.sql` |
| Tokens and devnet mints | `supabase/functions/solana-pay/solana.ts` |
| The devnet setup and the end-to-end run | `supabase/solana-pay-build/devnet.mjs`, `supabase/solana-pay-build/e2e.mjs` |

### 5. Running the code yourself

You can read, typecheck and test the code without any account of ours:

```
npm install        # Node.js 22.13+ or 24.3+
npx tsc --noEmit   # typecheck
npx expo lint
npm test           # 1,176 unit tests
```

The escrow program builds and tests on Linux, macOS or WSL. `solana/toolchain.sh` installs Rust, the Solana CLI and Anchor 1.2.2:

```
cd solana
anchor build       # the program, its IDL in target/idl
cargo test         # 9 tests on LiteSVM, against the built program
```

Running the app from source needs an iOS development build signed to Ka Technology's Apple and Expo accounts, and the test project's settings, which aren't in this copy. That's why a prebuilt TestFlight build is provided above.

## License

Copyright (c) 2026 Ka Technology LLC. All rights reserved. This code is shared for evaluation only, under the [Kept Evaluation License](LICENSE): the hackathon's organizers, judges and reviewers may read, clone, build and run it to judge Kept, and for nothing else. The license ends at 12:00 a.m. Pacific Time on November 17, 2026, when this repository is removed.
