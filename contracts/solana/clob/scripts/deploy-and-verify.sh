#!/usr/bin/env bash
# Deploy CLOB to Solana testnet (or devnet) and verify.
# Prereqs: anchor build, wallet funded (solana airdrop 2 on testnet/devnet).

set -e
CLUSTER="${1:-testnet}"
CLOB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CLOB_DIR"

echo "=== Configuring for $CLUSTER ==="
if [[ "$CLUSTER" == "testnet" ]]; then
  solana config set --url https://api.testnet.solana.com
else
  solana config set --url https://api.devnet.solana.com
fi

# Use deploy keypair if it exists and has SOL; else default wallet
if [[ -f deploy-testnet.json ]]; then
  solana config set --keypair "$(pwd)/deploy-testnet.json"
fi

echo "=== Wallet balance ==="
solana balance

echo "=== Deploying CLOB program to $CLUSTER ==="
anchor deploy --provider.cluster "$CLUSTER"

PROGRAM_ID=$(solana address -k target/deploy/clob-keypair.json 2>/dev/null || grep 'clob = ' Anchor.toml | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
echo "=== Program ID: $PROGRAM_ID ==="
echo "=== Verifying program on $CLUSTER ==="
solana program show "$PROGRAM_ID" --url "$(solana config get | grep 'RPC URL' | awk '{print $3}')"

echo "=== Done. Program is deployed and verified on $CLUSTER ==="
