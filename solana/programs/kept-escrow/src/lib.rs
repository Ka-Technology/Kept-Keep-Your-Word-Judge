//! Kept's escrow (T227, decision 178; SPEC-payments.md "S6"). A challenger's crypto stake is locked in its own
//! account for the length of the challenge, and Kept's rules for where it goes are enforced here, on chain:
//!
//! - `lock`: the challenger's stake moves into the escrow's vault. Kept's key (`KEPT`) co-signs and pays the
//!   rent, so only a transaction Kept built can open a challenge's escrow (its id is visible to friends and in
//!   Discover while the payment is awaited, so an open `lock` could be front-run).
//! - `settle`: Kept's key sends the whole vault either back to the challenger (finished, or cancelled on Day 1)
//!   or to the charity named at signing (not finished): to the token account of the charity's program address,
//!   which nobody holds a key for. Nowhere else, and only once.
//! - `reclaim`: once `reclaim_after` has passed (the challenge's length, the extra days a miss can add, and a grace
//!   period, set by Kept at signing), anyone can send a stake Kept never settled back to the challenger.
//!
//! The escrow account stays after it pays out, with its state, so a second copy of the signed `lock` transaction
//! (a wallet that fetched it twice) can never land and lock the money again. Kept's fee goes to its treasury in
//! the same transaction, outside this program. Classic SPL tokens only (USDC and Kept's test USDT); PYUSD, a
//! Token-2022 token, stays on the treasury. Devnet only until counsel and an audit (T172).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

declare_id!("4mN4zLWuZWQUbKR97DCr5vqWAXPHxuKQeQC8tC8nYfC1");

/// Kept's server key on devnet (solana-pay's fee payer, T221): it pays the rent and signs every lock and settle.
/// Changing it means upgrading the program.
pub const KEPT: Pubkey = pubkey!("C1o7T3VLQhu4Lriqhe19PH7FzfNneaouaYhWKnqhPzAw");

#[constant]
pub const ESCROW_SEED: &[u8] = b"escrow";
#[constant]
pub const CHARITY_SEED: &[u8] = b"charity";

/// An escrow's states: locked until it pays out once, then which way it went.
#[constant]
pub const LOCKED: u8 = 0;
#[constant]
pub const REFUNDED: u8 = 1;
#[constant]
pub const DONATED: u8 = 2;
#[constant]
pub const RECLAIMED: u8 = 3;

#[program]
pub mod kept_escrow {
    use super::*;

    /// Locks `amount` of the challenger's tokens for challenge `challenge_id` (its UUID's 16 bytes). `charity` is
    /// the sha256 of the charity's id, the only charity the stake can go to; `reclaim_after` is a unix time. The
    /// vault (the escrow's associated token account) is created earlier in the same transaction.
    pub fn lock(ctx: Context<Lock>, challenge_id: [u8; 16], amount: u64, charity: [u8; 32], reclaim_after: i64) -> Result<()> {
        require!(amount > 0, EscrowError::NoAmount);
        require!(reclaim_after > Clock::get()?.unix_timestamp, EscrowError::ReclaimInPast);
        ctx.accounts.escrow.set_inner(Escrow {
            challenge_id,
            challenger: ctx.accounts.challenger.key(),
            mint: ctx.accounts.mint.key(),
            amount,
            charity,
            reclaim_after,
            state: LOCKED,
            bump: ctx.bumps.escrow,
        });
        let accounts = TransferChecked {
            from: ctx.accounts.challenger_token.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.challenger.to_account_info(),
        };
        token::transfer_checked(CpiContext::new(ctx.accounts.token_program.key(), accounts), amount, ctx.accounts.mint.decimals)
    }

    /// Kept's decision at the end: `refund` sends the stake back to the challenger, otherwise it goes to the
    /// charity named at signing. Either way the whole vault moves (anything sent to it besides the stake too), and
    /// the vault's rent goes back to Kept.
    pub fn settle(ctx: Context<Settle>, refund: bool) -> Result<()> {
        let to = if refund { ctx.accounts.escrow.challenger } else { charity_account(&ctx.accounts.escrow.charity) };
        require_keys_eq!(ctx.accounts.destination.owner, to, EscrowError::WrongDestination);
        release(&ctx.accounts.escrow, &ctx.accounts.vault, &ctx.accounts.mint, &ctx.accounts.destination, &ctx.accounts.kept.to_account_info(), &ctx.accounts.token_program)?;
        ctx.accounts.escrow.state = if refund { REFUNDED } else { DONATED };
        Ok(())
    }

    /// Anyone, once `reclaim_after` has passed on an escrow Kept never settled: the stake goes back to the challenger.
    pub fn reclaim(ctx: Context<Reclaim>) -> Result<()> {
        require!(Clock::get()?.unix_timestamp >= ctx.accounts.escrow.reclaim_after, EscrowError::TooEarly);
        require_keys_eq!(ctx.accounts.destination.owner, ctx.accounts.escrow.challenger, EscrowError::WrongDestination);
        release(&ctx.accounts.escrow, &ctx.accounts.vault, &ctx.accounts.mint, &ctx.accounts.destination, &ctx.accounts.kept.to_account_info(), &ctx.accounts.token_program)?;
        ctx.accounts.escrow.state = RECLAIMED;
        Ok(())
    }
}

/// The charity's account for a charity's id hash: a program address nobody holds a key for, so tokens sent to its
/// token account stay there until a later `give` instruction (with Every.org's crypto API) sends them on.
pub fn charity_account(charity: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[CHARITY_SEED, charity], &crate::ID).0
}

/// Moves the vault's whole balance to `destination`, signed by the escrow, then closes the vault to Kept.
fn release<'info>(
    escrow: &Account<'info, Escrow>,
    vault: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    destination: &Account<'info, TokenAccount>,
    kept: &AccountInfo<'info>,
    token_program: &Program<'info, Token>,
) -> Result<()> {
    let bump = [escrow.bump];
    let seeds: &[&[u8]] = &[ESCROW_SEED, &escrow.challenge_id, &bump];
    let signer = &[seeds];
    let transfer = TransferChecked {
        from: vault.to_account_info(),
        mint: mint.to_account_info(),
        to: destination.to_account_info(),
        authority: escrow.to_account_info(),
    };
    token::transfer_checked(CpiContext::new_with_signer(token_program.key(), transfer, signer), vault.amount, mint.decimals)?;
    let close = CloseAccount { account: vault.to_account_info(), destination: kept.clone(), authority: escrow.to_account_info() };
    token::close_account(CpiContext::new_with_signer(token_program.key(), close, signer))
}

#[derive(Accounts)]
#[instruction(challenge_id: [u8; 16])]
pub struct Lock<'info> {
    #[account(mut, address = KEPT @ EscrowError::NotKept)]
    pub kept: Signer<'info>,
    pub challenger: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = challenger)]
    pub challenger_token: Account<'info, TokenAccount>,
    #[account(init, payer = kept, space = 8 + Escrow::INIT_SPACE, seeds = [ESCROW_SEED, challenge_id.as_ref()], bump)]
    pub escrow: Account<'info, Escrow>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = escrow)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut, address = KEPT @ EscrowError::NotKept)]
    pub kept: Signer<'info>,
    #[account(mut, seeds = [ESCROW_SEED, escrow.challenge_id.as_ref()], bump = escrow.bump, constraint = escrow.state == LOCKED @ EscrowError::NotLocked)]
    pub escrow: Account<'info, Escrow>,
    #[account(address = escrow.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = escrow)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Reclaim<'info> {
    /// CHECK: only receives the vault's rent back; its address is checked.
    #[account(mut, address = KEPT @ EscrowError::NotKept)]
    pub kept: UncheckedAccount<'info>,
    #[account(mut, seeds = [ESCROW_SEED, escrow.challenge_id.as_ref()], bump = escrow.bump, constraint = escrow.state == LOCKED @ EscrowError::NotLocked)]
    pub escrow: Account<'info, Escrow>,
    #[account(address = escrow.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = escrow)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// One challenge's escrow. solana-pay decodes it (solana.ts `decodeEscrow`) to check a payment before counting it.
#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub challenge_id: [u8; 16],
    pub challenger: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub charity: [u8; 32],
    pub reclaim_after: i64,
    pub state: u8,
    pub bump: u8,
}

#[error_code]
pub enum EscrowError {
    #[msg("Only Kept's key can do this")]
    NotKept,
    #[msg("A stake must be more than zero")]
    NoAmount,
    #[msg("The reclaim time must be in the future")]
    ReclaimInPast,
    #[msg("This escrow has already paid out")]
    NotLocked,
    #[msg("A stake can go only to its challenger or to the charity named at signing")]
    WrongDestination,
    #[msg("This stake can't be reclaimed yet")]
    TooEarly,
}
