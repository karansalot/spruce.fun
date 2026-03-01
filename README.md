<p align="center">
  <img src="https://img.shields.io/badge/Solana-Devnet-9945FF?style=for-the-badge&logo=solana" />
  <img src="https://img.shields.io/badge/Anchor-Rust-orange?style=for-the-badge&logo=rust" />
  <img src="https://img.shields.io/badge/Rust-Risk%20Engine-orange?style=for-the-badge&logo=rust" />
  <img src="https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js" />
</p>

# spruce.fun

**Fully on-chain Central Limit Order Book (CLOB) on Solana** with an SPL token position system, a Rust-powered risk engine, dynamic leverage bands, quadratic-voting dispute resolution, and a roadmap to become **Solana's flagship native prediction market & primary oracle for perpetuals**.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [On-Chain Orderbook](#on-chain-orderbook)
- [Risk Engine](#risk-engine)
- [Dynamic Leverage](#dynamic-leverage)
- [Quadratic Voting for Settlement Disputes](#quadratic-voting-for-settlement-disputes)
- [Future Scope](#future-scope)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Deployed Contracts](#deployed-contracts)
- [License](#license)

---

## Overview

spruce.fun is a prediction-market-style trading platform where the entire order matching engine lives on-chain. Users deposit USDC as collateral, place limit or market orders, and receive SPL position tokens (LONG or SHORT) when their orders are matched. The system is complemented by an off-chain Rust risk engine that monitors positions in real time, computes dynamic leverage caps, and triggers a three-stage liquidation waterfall when margin thresholds are breached. A Node.js backend streams live Polymarket orderbook data and OHLCV candles to the frontend via WebSocket.

### Key Features

| Feature | Description |
|---------|-------------|
| **On-chain CLOB** | Limit & market orders, matching, cancellation — all executed inside a single Anchor program on Solana. |
| **SPL Position Tokens** | Matched traders receive fungible position tokens (LONG, SHORT) equal to their filled quantity. |
| **USDC Collateral** | Both sides post collateral denominated in USDC. Price-improvement refunds happen atomically on match. |
| **Dynamic Leverage** | Leverage caps (1x–5x) are computed from each order's distance to the price boundary, preventing over-leverage on extreme prices. |
| **Rust Risk Engine** | Real-time margin monitoring at 500 ms sweeps with a three-stage liquidation waterfall (partial close, full close, ADL). |
| **Insurance Fund** | Liquidation surpluses flow into a shared fund; deficits draw from it before socializing losses. |
| **Quadratic Voting** | Settlement disputes are resolved on-chain via quadratic voting, preventing plutocratic capture. |
| **Polymarket Data Feed** | Node.js WebSocket backend streams live orderbook snapshots and OHLCV candles from Polymarket. |
| **Privy Auth** | Wallet, email, and social login via Privy — automatic chain switching to Solana Devnet. |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          FRONTEND                               │
│   Next.js 15  ·  React 19  ·  Tailwind  ·  Privy Auth          │
│                                                                 │
│   ┌───────────┐  ┌──────────────┐  ┌──────────────────────┐    │
│   │ Market    │  │ Trading      │  │ Orderbook Display    │    │
│   │ Cards     │  │ Panel        │  │ (on-chain polling)   │    │
│   └───────────┘  └──────┬───────┘  └──────────┬───────────┘    │
│                         │                     │                │
└─────────────────────────┼─────────────────────┼────────────────┘
                          │ sendTransaction     │ getAccountInfo
                          │                     │ WebSocket (candles)
                          ▼                     ▼
┌──────────────────────────────┐  ┌─────────────────────────────┐
│        SOLANA DEVNET         │  │     BACKEND (Node.js)       │
│                              │  │                             │
│  ┌──────────────────────┐    │  │  Express 5 + WebSocket      │
│  │  OnChainOrderBook    │    │  │                             │
│  │  (Anchor Program)    │    │  │  ┌─────────────────────┐   │
│  │                      │    │  │  │ Polymarket WS feed  │   │
│  │  place_limit_order() │    │  │  │ Candle aggregation  │   │
│  │  place_market_order()│    │  │  │ Orderbook snapshots │   │
│  │  cancel_order()      │    │  │  │ Supabase persistence│   │
│  │  settle()            │    │  │  └─────────────────────┘   │
│  └──────────────────────┘    │  └─────────────────────────────┘
└──────────────────────────────┘
                 ▲
                 │ price feed / position sync
                 │
┌─────────────────────────────────────────────────────────────────┐
│                      RISK ENGINE (Rust)                         │
│                                                                 │
│   ┌────────────┐  ┌────────────┐  ┌─────────────┐              │
│   │  Margin    │  │  Dynamic   │  │ Liquidation │              │
│   │  Calculator│  │  Leverage  │  │  Waterfall  │              │
│   └──────┬─────┘  └──────┬─────┘  └──────┬──────┘             │
│          │               │               │                     │
│   ┌──────▼───────────────▼───────────────▼──────┐              │
│   │           Position Monitor (500ms)          │              │
│   │    PnL tracking  ·  Insurance fund mgmt     │              │
│   └─────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

---

## On-Chain Orderbook

The `OnChainOrderBook` Anchor program is a fully self-contained CLOB deployed on Solana Devnet. Every order, match, and cancellation is an on-chain transaction — no off-chain relayer or sequencer.

### Order Lifecycle

```
User places order
        │
        ▼
┌───────────────┐     ┌─────────────┐
│ Lock USDC     │────►│ Match Engine │
│ collateral    │     │ (price-time │
└───────────────┘     │  priority)  │
                      └──────┬──────┘
                 ┌───────────┴───────────┐
                 ▼                       ▼
          Matched                  Rests on book
          ┌──────────┐            ┌──────────────┐
          │ Mint     │            │ Active order  │
          │ SPL      │            │ (cancelable)  │
          │ tokens   │            └──────────────┘
          └──────────┘
```

### SPL Position Tokens

When two orders match:

- **Buyer** receives `LONG_TOKEN` — quantity = matched shares
- **Seller** receives `SHORT_TOKEN` — quantity = matched shares

Tokens are freely transferable and composable with the broader SPL token ecosystem.

### Key Functions

| Function | Description |
|----------|-------------|
| `place_limit_order(is_buy, price, qty)` | Place a resting limit order. Auto-matches if a crossing order exists. |
| `place_market_order(is_buy, qty)` | IOC market order. Matches immediately; unfilled portion is refunded. |
| `cancel_order(order_id)` | Cancel a resting order and reclaim locked USDC. |
| `settle()` | Claim matched position tokens and any collateral refunds. |
| `collateral(is_buy, price, qty)` | Pure function — compute required USDC for an order. |
| `get_active_buy_orders()` | View all active buy orders on the book. |
| `get_active_sell_orders()` | View all active sell orders on the book. |
| `get_recent_trades(count)` | View the last N matched trades. |
| `get_user_active_orders(user)` | View a specific user's resting orders. |

---

## Risk Engine

The risk engine is a standalone Rust service (`risk_engine/`) that monitors positions and enforces margin requirements in real time.

### Margin Model

```
Initial Margin (IM) = (size × price) / leverage
Maintenance Margin  = IM × 0.5
Margin Balance      = deposited_margin + unrealized_PnL
```

- **Long PnL** = size × (mark_price − entry_price)
- **Short PnL** = size × (entry_price − mark_price)

### Three-Stage Liquidation Waterfall

```
Margin Balance < Maintenance Margin?
        │
        ▼
┌───────────────────┐
│ Stage 1: Partial  │  Close enough contracts to restore IM
│ Liquidation       │
└────────┬──────────┘
         │  still undercollateralized?
         ▼
┌───────────────────┐
│ Stage 2: Full     │  Close entire position
│ Liquidation       │
└────────┬──────────┘
         │  loss > margin?
         ▼
┌───────────────────┐
│ Stage 3: ADL      │  Auto-deleverage profitable
│ (future)          │  opposing positions
└───────────────────┘
```

### Insurance Fund

- **Surplus**: When a liquidation closes at a profit (liquidation price better than bankruptcy price), the surplus flows into the insurance fund.
- **Deficit**: When a liquidation results in a loss exceeding the deposited margin, the deficit is drawn from the insurance fund, capped at the fund's balance.

### Monitoring

The risk monitor sweeps all open positions every **500 ms**, computes unrealized PnL against the latest mark price (streamed via WebSocket from the price feed), and triggers liquidations when maintenance margin is breached.

---

## Dynamic Leverage

Leverage is not a flat cap — it scales dynamically based on how far the order price is from the boundary (0¢ or 100¢). This prevents users from taking on excessive risk when prices are already extreme.

### Leverage Bands

The **risk room** is the distance between the entry price and the nearer boundary:
- Long risk room = price (can fall to 0)
- Short risk room = 10,000 − price (can rise to 100¢)

| Risk Room | Leverage Cap | Example (Long) |
|-----------|-------------|----------------|
| 1–20¢     | 1x          | Price at 15¢ — very risky, no leverage |
| 21–40¢    | 2x          | Price at 30¢ |
| 41–60¢    | 3x          | Price at 50¢ |
| 61–80¢    | 4x          | Price at 70¢ |
| 81–99¢    | 5x          | Price at 90¢ — lots of room, max leverage |

This means a Short at 90¢ (risk room = 10¢) is capped at 1x, while a Long at 90¢ (risk room = 90¢) can use up to 5x.

### Liquidation Price Formula

```
Long:  liq_price = entry − (margin − MM) / size
Short: liq_price = entry + (margin − MM) / size
```

Where MM = 50% of initial margin. If the computed liquidation price falls below 0 or above 100¢, the position cannot be liquidated before the price hits the boundary.

---

## Quadratic Voting for Settlement Disputes

spruce.fun implements a **quadratic voting** (QV) mechanism for resolving settlement disputes on-chain. This is used when the outcome of a market is contested — for example, when an oracle reports an ambiguous result.

### How It Works

1. **Dispute Window**: After a market resolves, a dispute window opens. Any token holder can stake tokens to challenge the result.

2. **Quadratic Cost**: Votes are not 1-to-1. The cost to cast `n` votes is `n²` tokens:

   | Votes Cast | Token Cost | Marginal Cost |
   |-----------|------------|---------------|
   | 1         | 1          | 1             |
   | 2         | 4          | 3             |
   | 3         | 9          | 5             |
   | 10        | 100        | 19            |

3. **Why Quadratic?**: A linear voting system allows whales to dominate outcomes. Under QV, the cost of additional influence grows quadratically, so a well-funded minority cannot overpower a broad coalition of smaller holders. This makes the system more democratic and resistant to plutocratic capture.

4. **Resolution**: Once the dispute window closes, votes are tallied. If the dispute succeeds (more votes to overturn than to uphold), the market settlement is reversed and positions are re-settled at the corrected outcome. Losing voters' stakes are redistributed to winning voters as a reward for honest participation.

### Design Rationale

| Property | Linear Voting | Quadratic Voting |
|----------|--------------|------------------|
| Cost of 10 votes | 10 tokens | 100 tokens |
| Whale resistance | Low | High |
| Sybil resistance | None (need identity) | Economic (cost grows) |
| Preference intensity | Not captured | Captured via willingness to pay |

---

## Future Scope

### Quadratic Funding for Public Goods

Beyond dispute resolution (quadratic voting), spruce.fun will implement **quadratic funding (QF)** to bootstrap and sustain public goods within the ecosystem:

- **Market Creation Grants** — Anyone can propose a new prediction market. A matching pool funded by protocol fees amplifies small contributions from many users, so niche but valuable markets get funded even without whale backing.
- **Oracle Bounties** — Quadratic funding incentivizes community members to build and maintain resolution sources (data feeds, attestation networks) for market settlement.
- **Liquidity Mining Redesigned** — Instead of flat LP rewards, QF-weighted incentives direct liquidity subsidies toward markets that the community values most (measured by number of unique contributors, not dollar amount).

**How QF works:**

The matching amount for a project is proportional to the **square of the sum of square roots** of individual contributions, not the raw sum:

```
Matching ∝ (√c₁ + √c₂ + √c₃ + ... + √cₙ)²
```

This means 100 people each contributing $1 generates **far more** matching than 1 person contributing $100, directly encoding the democratic principle that breadth of support matters more than depth.

| Scenario | Individual Total | QF Match Factor |
|----------|-----------------|-----------------|
| 1 person × $100 | $100 | (√100)² = **100** |
| 100 people × $1 | $100 | (100 × √1)² = **10,000** |
| 25 people × $4 | $100 | (25 × √4)² = **2,500** |

### Gasless Trading via Solana Fee Sponsorship

Trading on-chain means every order, cancellation, and claim costs transaction fees. For mainstream adoption, that friction has to disappear. spruce.fun will integrate **transaction fee sponsorship** to cover fees for traders, making the experience feel as seamless as a centralized exchange.

```
┌────────────┐      Signed Transaction      ┌──────────────┐
│   Trader   │ ─────────────────────────▶  │   Fee Payer  │
│  (no SOL   │   (signed intent,           │  (spruce.fun  │
│   needed)  │    no fee payment)           │   sponsors)  │
└────────────┘                              └──────┬───────┘
                                                   │
                                                   ▼
                                     ┌──────────────────┐
                                     │   Solana         │
                                     │   Runtime        │
                                     └──────┬───────────┘
                                            │
                          ┌─────────────────┼─────────────────┐
                          ▼                 ▼                  ▼
                  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
                  │  Fee Sponsor │  │  User Wallet  │  │  OnChain     │
                  │  (spruce.fun │  │               │  │  OrderBook   │
                  │   pays fees) │  │               │  │  Program     │
                  └──────────────┘  └──────────────┘  └──────────────┘
```

| Without Fee Sponsorship | With Fee Sponsorship |
|---|---|
| User must hold SOL for fees | Zero fee cost for the trader |
| Every action = wallet popup for fees | Seamless, one-click trading |
| Onboarding requires acquiring native tokens | Sign up → trade immediately |
| High churn from fee UX friction | CEX-like experience, fully on-chain |

### Full Roadmap

| Phase | Milestone | Status |
|-------|-----------|--------|
| **Phase 1** | On-chain CLOB with SPL position tokens on Solana Devnet | ✅ Live |
| **Phase 2** | Rust risk engine with dynamic leverage & liquidation waterfall | ✅ Built |
| **Phase 3** | Quadratic voting for settlement disputes | 🔧 In progress |
| **Phase 4** | Solana-native prediction market (binary, multi-outcome, scalar) | 📋 Planned |
| **Phase 5** | Prediction market as oracle for perpetuals (mark price, funding) | 📋 Planned |
| **Phase 6** | Gasless trading via fee sponsorship | 📋 Planned |
| **Phase 7** | Quadratic funding for market creation & liquidity incentives | 📋 Planned |
| **Phase 8** | Cross-market composability (prediction ↔ perps ↔ options) | 📋 Planned |
| **Phase 9** | Mainnet deployment & protocol token launch | 📋 Planned |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Smart Contracts** | Rust, Anchor Framework |
| **Blockchain** | Solana Devnet |
| **Risk Engine** | Rust, Axum, Tokio, SQLx (Postgres), DashMap |
| **Backend** | Node.js, Express 5, WebSocket (ws), Supabase |
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS 4 |
| **Wallet Auth** | Privy (wallet, email, Google login) |
| **Chain Interaction** | @solana/web3.js, @coral-xyz/anchor, @solana/spl-token |
| **Data Fetching** | TanStack Query, lightweight-charts |
| **Collateral** | USDC (SPL Token) |

---

## Project Structure

```
spruce.fun/
├── contracts/                 # Smart contracts
│   └── solana/
│       └── clob/              # Anchor CLOB program
│           ├── programs/
│           │   └── clob/src/  # Anchor program source (lib.rs)
│           ├── scripts/       # Deployment & init scripts
│           ├── tests/         # Program integration tests
│           ├── Anchor.toml    # Anchor config
│           └── Cargo.toml
│
├── frontend/                  # Next.js trading interface
│   ├── app/
│   │   ├── components/        # Trading panel, orderbook, charts, etc.
│   │   ├── hooks/             # useCLOBOrderbook, useWebSocket
│   │   ├── market/[slug]/     # Individual market pages
│   │   ├── clob/              # Direct CLOB interface
│   │   ├── providers/         # React context providers
│   │   ├── types/             # TypeScript type definitions
│   │   └── api/               # Next.js API routes
│   ├── lib/
│   │   ├── clob.ts            # CLOB program interaction helpers
│   │   ├── constants.ts       # Chain config, USDC address, RPC endpoints
│   │   ├── marketConfig.ts    # Market definitions
│   │   ├── polymarketApi.ts   # Polymarket API client
│   │   └── idl/               # Anchor IDL files
│   └── package.json
│
├── backend/                   # Node.js WebSocket + HTTP server
│   ├── server.js              # Express + WebSocket entrypoint
│   ├── config/
│   │   └── marketConfig.js    # Market definitions & dynamic slugs
│   ├── services/
│   │   ├── state.js           # Shared in-memory state
│   │   ├── db.js              # Supabase (Postgres) client
│   │   ├── polymarketWsService.js   # Polymarket WebSocket subscription
│   │   ├── polymarketApiService.js  # Polymarket REST API (snapshots, history)
│   │   ├── orderbookService.js      # Orderbook state management
│   │   ├── candleService.js         # OHLCV candle building & DB persistence
│   │   ├── broadcastService.js      # WebSocket broadcasting to clients
│   │   └── marketDataService.js     # Event metadata fetching
│   └── package.json
│
└── risk_engine/               # Rust risk management service
    ├── src/
    │   ├── main.rs            # Axum server entrypoint
    │   ├── leverage.rs        # Dynamic leverage bands
    │   ├── margin.rs          # Margin & PnL calculations
    │   ├── liquidation.rs     # Three-stage liquidation waterfall
    │   ├── insurance.rs       # Insurance fund management
    │   ├── monitor.rs         # Real-time position monitor (500ms)
    │   ├── positions.rs       # Position CRUD
    │   ├── price_feed.rs      # WebSocket price stream
    │   ├── db.rs              # SQLx Postgres client
    │   └── config.rs          # Risk parameters
    ├── schema.sql             # Database schema
    └── Cargo.toml
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Rust 1.75+
- Anchor CLI (`cargo install --git https://github.com/coral-xyz/anchor avm --locked`)
- A Solana wallet with SOL (Devnet faucet) and USDC

### 1. Clone & Install

```bash
git clone https://github.com/your-org/spruce.fun.git
cd spruce.fun
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env   # Add your Privy App ID and program ID
npm run dev
```

### 3. Backend

```bash
cd backend
npm install
cp .env.example .env   # Add Supabase URL/key and Polymarket config
npm start
```

### 4. Smart Contracts

```bash
cd contracts/solana/clob
yarn install
anchor build

# Deploy (set wallet keypair)
anchor deploy --provider.cluster devnet
```

### 5. Risk Engine

```bash
cd risk_engine
cargo build --release
cargo run --release
```

### Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Frontend | Privy application ID |
| `NEXT_PUBLIC_CLOB_PROGRAM_ID` | Frontend | Deployed CLOB program ID |
| `NEXT_PUBLIC_CLOB_MARGIN_POOL` | Frontend | (Optional) Margin pool token account |
| `SUPABASE_URL` | Backend | Supabase project URL |
| `SUPABASE_KEY` | Backend | Supabase service role key |
| `ANCHOR_WALLET` | Contracts | Path to deployer keypair |

---

## Deployed Contracts

**Solana Devnet**

| Contract | Address |
|----------|---------|
| **CLOB Program** | `FoUdTt3bhy7JrKqFk9Uqg6vJVa4MFqRe4PTwRgxWQggB` |
| **Order Book (PDA)** | `DnrKJaYQv8NV5fTiL2zKhue7sPaefHvqB2TyzDEQtqG4` |
| **USDC Mint (Devnet)** | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

The order book PDA is derived from seed `["orderbook"]` + program ID. Vault, LONG mint, and SHORT mint are PDAs derived from the order book. See `contracts/solana/clob/README.md` for init and deploy details.

---

## License

MIT
