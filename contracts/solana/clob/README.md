# On-Chain CLOB (Solana)

An on-chain Central Limit Order Book on Solana, ported from the [Solidity OnChainOrderBook](../../src/OnChainOrderBook.sol) contract.

## Overview

- **Collateral**: USDC (or any SPL token with 6 decimals used as quote).
- **Prices**: Basis points (1–9999, where 10_000 = 1 USDC per share).
- **Positions**: LONG and SHORT are separate SPL mints; on match, the buyer receives LONG and the seller receives SHORT (claimed via `settle`).
- **Order types**: Limit orders (rest on book, auto-match) and IOC market orders (match immediately, refund unfilled).
- **Matching**: Price-time priority; execution price is the resting order’s price (price improvement for the taker).

## Build

```bash
cd contracts/solana/clob
yarn install
anchor build
```

Requires Rust 1.85+ (or a nightly with `edition2024`) for the Anchor 0.32 / Solana 2.x toolchain. If `anchor build` fails on `edition2024`, update Rust: `rustup update` or use the Solana toolchain: `solana-install init 2.2.1`.

## Test

Uses a local validator. Tests create a test USDC mint, initialize the book, place/cancel orders, and settle.

```bash
anchor test
```

All five tests must pass: initialize order book, place limit buy, place limit sell (match), settle LONG/SHORT, cancel order.

## Deploy

A dedicated keypair for deployment is at `deploy-testnet.json`. Fund it via faucet then deploy.

### Option A: Script (testnet or devnet)

```bash
# Testnet (default)
./scripts/deploy-and-verify.sh testnet

# Devnet
./scripts/deploy-and-verify.sh devnet
```

### Option B: Manual

**Testnet**

```bash
solana config set --url https://api.testnet.solana.com
solana config set --keypair deploy-testnet.json
solana airdrop 2   # if rate limited, try again later or use a testnet faucet
anchor deploy --provider.cluster testnet
```

**Devnet**

```bash
solana config set --url https://api.devnet.solana.com
solana config set --keypair deploy-testnet.json
solana airdrop 2
anchor deploy --provider.cluster devnet
```

## Verify on-chain

After deploy, confirm the program is deployed:

```bash
solana program show 3gHH4MLVgTtbFGeuX3LCPFeSEEY6kuRPwmTKzsrAdP7k --url <RPC_URL>
```

Use `https://api.testnet.solana.com` for testnet or `https://api.devnet.solana.com` for devnet.

## Initialize the order book

You can initialize the order book **programmatically** using the deployer keypair (the same keypair used to deploy the program). This avoids requiring users to click “Initialize” in the app.

**Deployer signer (authority):** `6Cu2Uuctw13bdyEfcJnL1XYMPDYk6emBNtLAueu2bufL` — ensure your keypair file (e.g. `deploy-testnet.json`) corresponds to this public key and has SOL for init.

### One-time init script

From the `contracts/solana/clob` directory:

```bash
# Ensure keypair exists and is funded (e.g. deploy-testnet.json for 6Cu2Uuctw13bdyEfcJnL1XYMPDYk6emBNtLAueu2bufL)
anchor build
npm run initialize-orderbook
```

Optional env vars:

| Env | Default | Description |
|-----|---------|-------------|
| `KEYPAIR_PATH` | `deploy-testnet.json` | Path to deployer keypair (relative to clob dir or absolute). |
| `RPC_URL` | `https://api.devnet.solana.com` | Solana RPC. |
| `CLOB_PROGRAM_ID` | `3gHH4MLVgTtbFGeuX3LCPFeSEEY6kuRPwmTKzsrAdP7k` | CLOB program ID. |
| `USDC_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Devnet USDC mint. |
| `CLOB_SYMBOL` | `FED-CHAIR` | Order book symbol. |

If the order book is already initialized, the script no-ops and prints the current symbol.

### Initialize all orderbooks on the platform

- **On-chain (Solana):** There is **one** order book per CLOB program. Initialize it once with the script above (`npm run initialize-orderbook` in `contracts/solana/clob`).
- **Hosted API (Railway):** The frontend uses a hosted orderbook service with one book per symbol. From the **frontend** directory run:
  ```bash
  npm run initialize-all-orderbooks
  ```
  This registers every symbol from `MARKET_CONFIGS` (and FED-CHAIR) with the hosted service at `NEXT_PUBLIC_ORDERBOOK_API` (default: perporderbook-production.up.railway.app).

### Manual init (e.g. from frontend)

Pass the existing USDC mint (e.g. devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) and a symbol:

- `initialize(symbol: "SPRUCE")` with accounts: `orderBook`, `longMint`, `shortMint`, `usdcVault`, `usdcMint`, `authority`, system/token/rent.

## Instructions

| Instruction            | Description |
|------------------------|-------------|
| `initialize(symbol)`   | Create the order book, LONG/SHORT mints, and USDC vault. |
| `place_limit_order(is_buy, price, qty)` | Place a limit order; matches immediately, remainder rests. |
| `place_market_order(is_buy, qty)`      | IOC: match immediately, refund unfilled. |
| `cancel_order(order_id)`               | Cancel resting order and return USDC. |
| `settle()`                             | Claim LONG/SHORT tokens and USDC refunds from matches. |

## Differences from Solidity

- **Settle step**: On Solana, matched size and refunds are credited to a `UserPosition`; users must call `settle()` to mint LONG/SHORT and receive USDC. The Solidity version mints ERC-1155 and transfers USDC in the same transaction.
- **Capacity**: Order books are capped (16 buy / 16 sell orders, 32 user positions, 32 trades in history) to keep account size under the 10KB realloc limit on-chain.

## Program ID

Current (from `target/deploy/clob-keypair.json`): `3gHH4MLVgTtbFGeuX3LCPFeSEEY6kuRPwmTKzsrAdP7k`

## Contract addresses (Devnet)

| Contract | Address |
|----------|---------|
| **CLOB Program** | `3gHH4MLVgTtbFGeuX3LCPFeSEEY6kuRPwmTKzsrAdP7k` |
| **Order Book PDA** | `DnrKJaYQv8NV5fTiL2zKhue7sPaefHvqB2TyzDEQtqG4` |
| **USDC Mint** | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

- **Order book** PDA: `["orderbook"]` + program ID.
- **Vault**, **LONG mint**, **SHORT mint**: PDAs derived from the order book PDA (seeds `["vault", order_book]`, `["long_mint", order_book]`, `["short_mint", order_book]`).
- **Authority** (init / set_margin_pool): set at init; current init used `6Cu2Uuctw13bdyEfcJnL1XYMPDYk6emBNtLAueu2bufL`.
