//! The escrow's rules (T227), run on LiteSVM against the built program (`anchor build`, then `cargo test`).
//! Signatures aren't checked here (`with_sigverify(false)`), so a transaction can name Kept's devnet key as a signer
//! without holding it; whether a key signed is still the transaction's header, which is what the program reads.

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::associated_token::get_associated_token_address,
    kept_escrow::{accounts, charity_account, instruction, Escrow, DONATED, KEPT, LOCKED, RECLAIMED, REFUNDED},
    litesvm::LiteSVM,
    litesvm_token::{get_spl_account, spl_token::state::Account as TokenAccount, CreateAssociatedTokenAccount, CreateAssociatedTokenAccountIdempotent, CreateMint, MintTo},
    solana_keypair::Keypair,
    solana_message::Message,
    solana_signer::Signer,
    solana_transaction::Transaction,
};

/// $10 in a 6-decimal stablecoin.
const STAKE: u64 = 10_000_000;
/// sha256 of the charity's id stands here as any 32 bytes.
const CHARITY: [u8; 32] = [7; 32];
const OTHER_CHARITY: [u8; 32] = [8; 32];
const SOL: u64 = 1_000_000_000;

struct World {
    svm: LiteSVM,
    payer: Keypair,
    challenger: Keypair,
    mint: Pubkey,
    challenger_token: Pubkey,
}

/// A mint, and a challenger holding three stakes of it; Kept's key funded for rent.
fn world() -> World {
    let mut svm = LiteSVM::new().with_sigverify(false).with_transaction_history(0);
    svm.add_program(kept_escrow::id(), include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/kept_escrow.so")))
        .unwrap();
    let payer = Keypair::new();
    let challenger = Keypair::new();
    for who in [payer.pubkey(), challenger.pubkey(), KEPT] {
        svm.airdrop(&who, 10 * SOL).unwrap();
    }
    let mint = CreateMint::new(&mut svm, &payer).decimals(6).send().unwrap();
    let owner = challenger.pubkey();
    let challenger_token = CreateAssociatedTokenAccount::new(&mut svm, &payer, &mint).owner(&owner).send().unwrap();
    MintTo::new(&mut svm, &payer, &mint, &challenger_token, 3 * STAKE).send().unwrap();
    World { svm, payer, challenger, mint, challenger_token }
}

fn escrow_of(id: &[u8; 16]) -> Pubkey {
    Pubkey::find_program_address(&[b"escrow", id], &kept_escrow::id()).0
}

fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
}

fn held(svm: &LiteSVM, account: &Pubkey) -> u64 {
    get_spl_account::<TokenAccount>(svm, account).unwrap().amount
}

fn escrow(svm: &LiteSVM, address: &Pubkey) -> Escrow {
    let account = svm.get_account(address).unwrap();
    Escrow::try_deserialize(&mut account.data.as_slice()).unwrap()
}

/// Sends the instructions with `fee_payer` paying; the error carries the program's logs, to match its error names.
fn send(svm: &mut LiteSVM, ixs: &[Instruction], fee_payer: &Pubkey) -> Result<(), String> {
    let message = Message::new_with_blockhash(ixs, Some(fee_payer), &svm.latest_blockhash());
    svm.send_transaction(Transaction::new_unsigned(message)).map(|_| ()).map_err(|e| format!("{:?}\n{}", e.err, e.meta.logs.join("\n")))
}

/// The escrow's vault, created the way solana-pay does, before `lock` (idempotent: an existing one is fine).
fn vault(w: &mut World, escrow: &Pubkey) -> Pubkey {
    CreateAssociatedTokenAccountIdempotent::new(&mut w.svm, &w.payer, &w.mint).owner(escrow).send().unwrap()
}

/// A token account of `w.mint` for `owner` (a wallet, or the charity's program address).
fn token_account(w: &mut World, owner: &Pubkey) -> Pubkey {
    CreateAssociatedTokenAccountIdempotent::new(&mut w.svm, &w.payer, &w.mint).owner(owner).send().unwrap()
}

/// The `lock` instruction as `kept` (signing or not) for challenge `id`.
fn lock_ix(w: &World, id: [u8; 16], kept: Pubkey, kept_signs: bool, amount: u64, reclaim_after: i64) -> Instruction {
    let escrow = escrow_of(&id);
    let mut metas = accounts::Lock {
        kept,
        challenger: w.challenger.pubkey(),
        mint: w.mint,
        challenger_token: w.challenger_token,
        escrow,
        vault: get_associated_token_address(&escrow, &w.mint),
        token_program: anchor_spl::token::ID,
        system_program: system_program::ID,
    }
    .to_account_metas(None);
    metas[0].is_signer = kept_signs;
    Instruction::new_with_bytes(kept_escrow::id(), &instruction::Lock { challenge_id: id, amount, charity: CHARITY, reclaim_after }.data(), metas)
}

/// The `settle` instruction as `kept` (signing or not), paying out to `destination`.
fn settle_ix(w: &World, id: [u8; 16], kept: Pubkey, kept_signs: bool, refund: bool, destination: Pubkey) -> Instruction {
    let escrow = escrow_of(&id);
    let mut metas = accounts::Settle {
        kept,
        escrow,
        mint: w.mint,
        vault: get_associated_token_address(&escrow, &w.mint),
        destination,
        token_program: anchor_spl::token::ID,
    }
    .to_account_metas(None);
    metas[0].is_signer = kept_signs;
    Instruction::new_with_bytes(kept_escrow::id(), &instruction::Settle { refund }.data(), metas)
}

fn reclaim_ix(w: &World, id: [u8; 16], destination: Pubkey) -> Instruction {
    let escrow = escrow_of(&id);
    let metas = accounts::Reclaim {
        kept: KEPT,
        escrow,
        mint: w.mint,
        vault: get_associated_token_address(&escrow, &w.mint),
        destination,
        token_program: anchor_spl::token::ID,
    }
    .to_account_metas(None);
    Instruction::new_with_bytes(kept_escrow::id(), &instruction::Reclaim {}.data(), metas)
}

/// Locks a stake for challenge `id` the way Kept does, reclaimable in an hour.
fn locked(w: &mut World, id: [u8; 16]) -> Pubkey {
    let escrow = escrow_of(&id);
    let vault = vault(w, &escrow);
    let ix = lock_ix(w, id, KEPT, true, STAKE, now(&w.svm) + 3600);
    send(&mut w.svm, &[ix], &KEPT).unwrap();
    vault
}

#[test]
fn lock_moves_the_exact_stake_and_records_it() {
    let mut w = world();
    let vault = locked(&mut w, [1; 16]);
    assert_eq!(held(&w.svm, &vault), STAKE);
    assert_eq!(held(&w.svm, &w.challenger_token), 2 * STAKE);
    let e = escrow(&w.svm, &escrow_of(&[1; 16]));
    assert_eq!((e.challenger, e.mint, e.amount, e.charity, e.state), (w.challenger.pubkey(), w.mint, STAKE, CHARITY, LOCKED));
}

#[test]
fn a_challenge_locks_once() {
    let mut w = world();
    locked(&mut w, [2; 16]);
    let again = lock_ix(&w, [2; 16], KEPT, true, STAKE, now(&w.svm) + 3600);
    assert!(send(&mut w.svm, &[again], &KEPT).is_err());
    assert_eq!(held(&w.svm, &w.challenger_token), 2 * STAKE);
}

#[test]
fn only_kept_can_open_an_escrow() {
    let mut w = world();
    vault(&mut w, &escrow_of(&[3; 16]));
    // Kept's key named but not signing (the challenger pays the fee).
    let unsigned = lock_ix(&w, [3; 16], KEPT, false, STAKE, now(&w.svm) + 3600);
    assert!(send(&mut w.svm, &[unsigned], &w.challenger.pubkey()).is_err());
    // Someone else's key in Kept's place.
    let other = Keypair::new().pubkey();
    w.svm.airdrop(&other, SOL).unwrap();
    let forged = lock_ix(&w, [3; 16], other, true, STAKE, now(&w.svm) + 3600);
    assert!(send(&mut w.svm, &[forged], &other).unwrap_err().contains("NotKept"));
    // Nothing moved, and nothing stops Kept's real lock afterwards.
    assert_eq!(held(&w.svm, &w.challenger_token), 3 * STAKE);
    locked(&mut w, [3; 16]);
}

#[test]
fn a_lock_needs_a_stake_and_a_future_reclaim_time() {
    let mut w = world();
    vault(&mut w, &escrow_of(&[4; 16]));
    let zero = lock_ix(&w, [4; 16], KEPT, true, 0, now(&w.svm) + 3600);
    assert!(send(&mut w.svm, &[zero], &KEPT).unwrap_err().contains("NoAmount"));
    let past = lock_ix(&w, [4; 16], KEPT, true, STAKE, now(&w.svm) - 1);
    assert!(send(&mut w.svm, &[past], &KEPT).unwrap_err().contains("ReclaimInPast"));
}

#[test]
fn settle_refunds_the_challenger_and_returns_the_vault_rent_to_kept() {
    let mut w = world();
    let vault = locked(&mut w, [5; 16]);
    let kept_before = w.svm.get_balance(&KEPT).unwrap();
    let to = w.challenger_token;
    // The payer pays the fee here, so Kept's balance shows only the vault's rent coming back.
    let ix = settle_ix(&w, [5; 16], KEPT, true, true, to);
    send(&mut w.svm, &[ix], &w.payer.pubkey()).unwrap();
    assert_eq!(held(&w.svm, &w.challenger_token), 3 * STAKE);
    assert!(w.svm.get_account(&vault).map_or(true, |a| a.lamports == 0), "the vault is closed");
    assert!(w.svm.get_balance(&KEPT).unwrap() > kept_before);
    assert_eq!(escrow(&w.svm, &escrow_of(&[5; 16])).state, REFUNDED);
}

#[test]
fn settle_gives_only_to_the_charity_named_at_signing() {
    let mut w = world();
    locked(&mut w, [6; 16]);
    let charity = token_account(&mut w, &charity_account(&CHARITY));
    let other_charity = token_account(&mut w, &charity_account(&OTHER_CHARITY));
    let wrong_charity = settle_ix(&w, [6; 16], KEPT, true, false, other_charity);
    assert!(send(&mut w.svm, &[wrong_charity], &KEPT).unwrap_err().contains("WrongDestination"));
    let to_challenger_as_gift = settle_ix(&w, [6; 16], KEPT, true, false, w.challenger_token);
    assert!(send(&mut w.svm, &[to_challenger_as_gift], &KEPT).unwrap_err().contains("WrongDestination"));
    let refund_to_charity = settle_ix(&w, [6; 16], KEPT, true, true, charity);
    assert!(send(&mut w.svm, &[refund_to_charity], &KEPT).unwrap_err().contains("WrongDestination"));
    let give = settle_ix(&w, [6; 16], KEPT, true, false, charity);
    send(&mut w.svm, &[give], &KEPT).unwrap();
    assert_eq!(held(&w.svm, &charity), STAKE);
    assert_eq!(escrow(&w.svm, &escrow_of(&[6; 16])).state, DONATED);
}

#[test]
fn only_kept_settles_and_only_once() {
    let mut w = world();
    locked(&mut w, [7; 16]);
    let to = w.challenger_token;
    let unsigned = settle_ix(&w, [7; 16], KEPT, false, true, to);
    assert!(send(&mut w.svm, &[unsigned], &w.challenger.pubkey()).is_err());
    let other = Keypair::new().pubkey();
    w.svm.airdrop(&other, SOL).unwrap();
    let forged = settle_ix(&w, [7; 16], other, true, true, to);
    assert!(send(&mut w.svm, &[forged], &other).unwrap_err().contains("NotKept"));
    let first = settle_ix(&w, [7; 16], KEPT, true, true, to);
    send(&mut w.svm, &[first], &KEPT).unwrap();
    // The vault is closed, so a second settle is refused; and if anyone recreates it, the escrow's state refuses it.
    let again = settle_ix(&w, [7; 16], KEPT, true, true, to);
    assert!(send(&mut w.svm, &[again.clone()], &KEPT).unwrap_err().contains("AccountNotInitialized"));
    vault(&mut w, &escrow_of(&[7; 16]));
    assert!(send(&mut w.svm, &[again], &KEPT).unwrap_err().contains("NotLocked"));
    assert_eq!(held(&w.svm, &w.challenger_token), 3 * STAKE);
}

#[test]
fn a_vault_sent_extra_tokens_still_settles_in_full() {
    let mut w = world();
    // Someone creates the vault first and sends it a token, before Kept's lock.
    let vault = vault(&mut w, &escrow_of(&[8; 16]));
    MintTo::new(&mut w.svm, &w.payer, &w.mint, &vault, 1).send().unwrap();
    let lock = lock_ix(&w, [8; 16], KEPT, true, STAKE, now(&w.svm) + 3600);
    send(&mut w.svm, &[lock], &KEPT).unwrap();
    let settle = settle_ix(&w, [8; 16], KEPT, true, true, w.challenger_token);
    send(&mut w.svm, &[settle], &KEPT).unwrap();
    assert_eq!(held(&w.svm, &w.challenger_token), 3 * STAKE + 1);
}

#[test]
fn anyone_can_reclaim_for_the_challenger_once_its_time_has_passed() {
    let mut w = world();
    locked(&mut w, [9; 16]);
    let bystander = Keypair::new().pubkey();
    w.svm.airdrop(&bystander, SOL).unwrap();
    let to = w.challenger_token;
    let early = reclaim_ix(&w, [9; 16], to);
    assert!(send(&mut w.svm, &[early], &bystander).unwrap_err().contains("TooEarly"));

    let mut clock = w.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = escrow(&w.svm, &escrow_of(&[9; 16])).reclaim_after;
    w.svm.set_sysvar::<Clock>(&clock);
    let charity = token_account(&mut w, &charity_account(&CHARITY));
    let to_charity = reclaim_ix(&w, [9; 16], charity);
    assert!(send(&mut w.svm, &[to_charity], &bystander).unwrap_err().contains("WrongDestination"));
    let reclaim = reclaim_ix(&w, [9; 16], to);
    send(&mut w.svm, &[reclaim], &bystander).unwrap();
    assert_eq!(held(&w.svm, &w.challenger_token), 3 * STAKE);
    assert_eq!(escrow(&w.svm, &escrow_of(&[9; 16])).state, RECLAIMED);
    // Kept can't settle it afterwards, even with the vault recreated.
    vault(&mut w, &escrow_of(&[9; 16]));
    let late = settle_ix(&w, [9; 16], KEPT, true, false, charity);
    assert!(send(&mut w.svm, &[late], &KEPT).unwrap_err().contains("NotLocked"));
}
