#!/usr/bin/env bash
# The Solana + Anchor toolchain for the escrow program (T226), in Ubuntu WSL. These are the steps of the
# quick installer on anchor-lang.com/docs/installation (solana-install.solana.workers.dev, read 2026-11-02),
# run one by one, without its surfpool and global agent-skill extras. From Windows:
#   wsl -d Ubuntu -e bash /mnt/d/Code/Ka/Kept/solana/toolchain.sh
# It logs each step and ends with TOOLCHAIN_DONE. Safe to run again: each step is skipped once installed.
set -uo pipefail
step() { echo "=== $(date +%H:%M:%S) $*"; }
SUDO=$([ "$(id -u)" = 0 ] && echo "" || echo sudo)

step apt
export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update -qq && $SUDO apt-get install -y -qq build-essential pkg-config libudev-dev llvm libclang-dev protobuf-compiler libssl-dev curl git >/dev/null || { echo "APT_FAILED"; exit 1; }

step rustup
[ -x "$HOME/.cargo/bin/rustc" ] || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y >/dev/null || { echo "RUSTUP_FAILED"; exit 1; }
. "$HOME/.cargo/env"
rustc --version

step solana-cli
[ -x "$HOME/.local/share/solana/install/active_release/bin/solana" ] || sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)" >/dev/null || { echo "SOLANA_FAILED"; exit 1; }
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
grep -q 'solana/install/active_release/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> "$HOME/.bashrc"
solana --version

step avm-and-anchor
if ! command -v avm >/dev/null 2>&1; then
  # The docs page's repo first; the quick installer's pinned one if that fails.
  cargo install --git https://github.com/otter-sec/anchor avm --force >/dev/null 2>&1 \
    || cargo install --force --git https://github.com/solana-foundation/anchor --tag v1.1.2 avm >/dev/null 2>&1 \
    || { echo "AVM_FAILED"; exit 1; }
fi
avm --version
(avm install latest >/dev/null 2>&1 && avm use latest >/dev/null 2>&1) || (avm install 1.1.2 >/dev/null 2>&1 && avm use 1.1.2 >/dev/null 2>&1) || { echo "ANCHOR_FAILED"; exit 1; }
anchor --version

step node
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] || curl -so- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash >/dev/null
. "$NVM_DIR/nvm.sh"
nvm install 24 >/dev/null 2>&1 && nvm alias default 24 >/dev/null && node --version
command -v yarn >/dev/null 2>&1 || npm install --global yarn >/dev/null 2>&1
yarn --version

# Builds go to WSL's own disk (cargo over /mnt/d is very slow). Through CARGO_TARGET_DIR, never a solana/target
# symlink: Windows can't read a link WSL makes there, and Metro's crawl of the repo stops on it (EACCES).
grep -q 'CARGO_TARGET_DIR' "$HOME/.bashrc" || echo 'export CARGO_TARGET_DIR="$HOME/kept-target/escrow"' >> "$HOME/.bashrc"
step TOOLCHAIN_DONE
