# PerpMarket Backend

Node.js backend for streaming Polymarket orderbook data, building real-time candles, and serving the frontend via HTTP and WebSocket. Supports multiple configurable markets (binary and multi-outcome) with optional dynamic slug rotation (e.g. hourly Bitcoin markets).

---

## Overview

The backend:

- **Connects to Polymarket** over WebSocket to receive live orderbook and trade updates.
- **Maintains in-memory orderbook state** per outcome (bids/asks) and **OHLCV candles** (1s, 1m, 5m, 15m, 1h).
- **Broadcasts** orderbook updates, candle updates, and market-change events to connected WebSocket clients.
- **Exposes an HTTP API** for health, market metadata, historical candles, and market switching.
- **Optionally persists 1s candles** to Supabase and aggregates them for higher timeframes on demand.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  Polymarket WS (wss://ws-subscriptions-clob.polymarket.com)              │
│  Polymarket REST (gamma-api, clob.polymarket.com)                        │
│  Supabase (optional – market_candles_1s)                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (this repo)                            │
├─────────────────────────────────────────────────────────────────────────┤
│  server.js                                                               │
│  ├── Express (HTTP)          → /api/candles, /api/health, /api/market…   │
│  └── WebSocket (ws)          → connected clients get live orderbook     │
│                                                                          │
│  config/marketConfig.js      → MARKET_CONFIGS, TIMEFRAMES, slug logic   │
│  services/state.js           → shared mutable state (orderbook, etc.)   │
│  services/initService.js     → bootstrap: fetch market → WS → orderbook │
│  services/polymarketWsService.js  → Polymarket WS connect & subscribe  │
│  services/polymarketApiService.js → REST: orderbook, price history      │
│  services/marketDataService.js    → event slug → asset IDs, outcomes    │
│  services/orderbookService.js    → orderbook state, process updates    │
│  services/candleService.js        → OHLCV build, save, aggregate        │
│  services/broadcastService.js     → send JSON to all WS clients         │
│  services/datetimeService.js     → ET time for dynamic slugs            │
│  services/db.js                 → Supabase client (optional)            │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENTS                                        │
│  Browsers / apps: HTTP API + WebSocket (orderbook + candles + market)    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Data flow (high level):**

1. **Startup:** `initialize()` (initService) loads active market config → fetches asset IDs/outcomes (marketDataService + Polymarket API) → initializes orderbook/candle state (orderbookService) → connects to Polymarket WS (polymarketWsService) → loads initial orderbooks (orderbookService + polymarketApiService) → starts time monitoring (for dynamic slugs) and candle ticker.
2. **Live:** Polymarket WS messages → `processOrderBookUpdate()` (orderbookService) → state updated → `broadcast()` (broadcastService) to clients; candle service updates in-memory candles and optionally queues 1s writes to Supabase.
3. **Candles:** Every second a ticker runs `processPriceForCandles()` so candles advance even without new trades; 1s candles are queued/saved to DB; higher timeframes are computed in-memory or by aggregating 1s from DB when requested via API.

---

## Tech Stack

- **Runtime:** Node.js (ES modules)
- **HTTP:** Express (CORS, JSON)
- **WebSocket:** `ws`
- **Database (optional):** Supabase (Postgres) via `@supabase/supabase-js`
- **Config:** `dotenv` for env vars

---

## Project Structure

```
backend/
├── server.js                 # Entry: Express + WebSocket servers, routes, shutdown
├── package.json
├── Procfile                  # Railway: web: node server.js
├── railway.json              # Railway deploy config
├── config/
│   └── marketConfig.js       # Market definitions, timeframes, slug generation
└── services/
    ├── state.js              # Shared in-memory state (orderbooks, candles, clients, etc.)
    ├── db.js                 # Supabase client; DB_ENABLED flag
    ├── initService.js        # Single entrypoint to bootstrap server
    ├── polymarketWsService.js   # Polymarket WebSocket connect, subscribe, time/candle tickers
    ├── polymarketApiService.js  # Polymarket REST: orderbook snapshot, price history
    ├── marketDataService.js     # Fetch event by slug, extract asset IDs & outcomes
    ├── orderbookService.js      # Orderbook state, process updates, load initial books
    ├── candleService.js         # Build/update candles, save 1s to DB, aggregate from DB
    ├── broadcastService.js      # Send message to all WebSocket clients
    └── datetimeService.js       # ET time for dynamic slugs (e.g. Bitcoin hourly)
```

---

## Configuration

### Market config (`config/marketConfig.js`)

- **`MARKET_CONFIGS`** – Array of market definitions. Each can have:
  - `id`, `type` (`"binary"` | `"multi"`)
  - `dynamicSlug`: if `true`, slug is generated (e.g. by hour in ET)
  - `slug` (static) or `slugGenerator` (dynamic)
  - `timezone`, `rotationInterval` (e.g. `"hourly"`) for when to re-fetch market
  - `outcomeMapping`: optional ordering/filtering of outcomes
- **`TIMEFRAMES`** – Supported candle intervals (1s, 1m, 5m, 15m, 1h).
- **`AGGREGATABLE_TIMEFRAMES`** – Timeframes derived by aggregating 1s candles from DB (1m, 5m, 15m, 1h).
- **`POLYMARKET_WS_URL`** – Polymarket WebSocket base URL.
- **`CANDLE_TICK_INTERVAL_MS`** – Interval for the candle ticker (default 1000 ms).

Active market is chosen by `DEFAULT_MARKET` env var (or first config). It can be switched at runtime via `POST /api/market/switch`.

### Environment variables

- **Server:** `PORT` (WebSocket when using two ports), `HTTP_PORT`, `NODE_ENV`, `USE_SINGLE_PORT` (if set, one port for both HTTP and WS).
- **Database:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (or anon keys). If both URL and key are set, DB is enabled and 1s candles are persisted.
- **Market:** `DEFAULT_MARKET` – market `id` from `MARKET_CONFIGS`.
- **Optional:** `DEBUG_CANDLE_GAPS=true` to log candle gaps; `NETWORK` for payment endpoint.
- **Hot wallet (trade settlement):** `HOT_WALLET_ADDRESS` – the wallet that receives and sends amounts for all trades. If unset, defaults to `0x4CbEe7aD42d33e9D3B41e8b6FAcA2f6f173C8A94`. Used by `GET /api/settlement/partner-address`.

---

## Services (in detail)

| Service                     | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **state.js**                | Single place for mutable server state: Polymarket WS handle, `currentAssetIds`, `currentOutcomes`, `clobTokenIdsByOutcome`, `currentMarketMetadata`, `orderBookState` (bids/asks per outcome), `candleState`, `candleSaveQueue`, `clients` (WS set), `isShuttingDown`. All access via getters/setters.                                                                                                                                                                                                                                                                                                                                             |
| **db.js**                   | Creates Supabase client from env; exports `supabase` and `DB_ENABLED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **initService.js**          | `initialize()`: get active market config → fetch asset IDs/outcomes → set state → initialize orderbook/candle state → connect Polymarket WS → load initial orderbooks → start time monitoring and candle ticker. Called once at server startup.                                                                                                                                                                                                                                                                                                                                                                                                    |
| **polymarketWsService.js**  | Connects to Polymarket WS, sends `market` subscription with `assets_ids`; on message dispatches to `processOrderBookUpdate`. Handles reconnect on close. `updateMarketSubscription()` re-fetches market data and reconnects WS (used on market switch or rotation). `startTimeMonitoring()` runs an interval to check rotation (e.g. hourly) and call `updateMarketSubscription()`. `startCandleTicker()` runs every second to call `processPriceForCandles` for each outcome.                                                                                                                                                                     |
| **polymarketApiService.js** | REST: `fetchInitialOrderbook(assetId)` (CLOB book by token), `fetchPolymarketHistory(assetId, fidelity)` (price history). Used for initial orderbook load and fallback history for candles.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **marketDataService.js**    | `fetchMarketData(slug)` – GET event by slug from Gamma API. `extractClobTokenIds(response)` – parses response for binary vs multi-outcome and applies `outcomeMapping`; returns token IDs and outcomes. `fetchCurrentAssetIds()` – uses `generateSlug()`, fetches market data, extracts token IDs/outcomes/metadata and returns them for init and market updates.                                                                                                                                                                                                                                                                                  |
| **orderbookService.js**     | `initializeMarketState(outcomes)` – creates empty orderbook and candle state per outcome. `processOrderBookUpdate(data)` – handles `price_change`, full snapshot (bids/asks), `last_trade_price`, `tick_size_change`; updates state and broadcasts; triggers candle updates on price/trade. `loadInitialOrderbooks()` – fetches CLOB book for each asset and feeds into `processOrderBookUpdate`. Re-exports `getCurrentPrice` from candleService.                                                                                                                                                                                                 |
| **candleService.js**        | `getCurrentPrice(outcomeKey)` – best ask or best bid from orderbook. `updateCandle(outcomeKey, timeframe, price, volume)` – updates or creates candle for current bucket; broadcasts `candle_update`; for 1s, queues DB save. `processPriceForCandles(outcomeKey)` – takes current price and volume and updates all timeframes. `saveCandle` / `queueSaveCandle` – persist 1s candles to Supabase (`market_candles_1s`) with conflict on `market_id, ts`. `fetchAggregatedCandlesFrom1s(marketId, timeframe, limit)` – reads 1s from DB and aggregates into requested timeframe. `flushInMemoryCandles` / `waitForQueuedSaves` – used on shutdown. |
| **broadcastService.js**     | `broadcast(message)` – stringifies and sends to every client in `getClients()` whose `readyState === OPEN`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **datetimeService.js**      | `getETDateTime()` – returns month, day, hour, ampm, rawHour in America/New_York for dynamic slug generation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## HTTP API

| Method | Path                               | Description                                                                                                                                                                                                                                              |
| ------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`                      | Status, connected client count, active market id/type/slug/title/assetIds/outcomes (and clobTokenIdsByOutcome if multi).                                                                                                                                 |
| GET    | `/api/market`                      | Active market metadata (id, type, slug, title, image, assetIds, outcomes, dynamicSlug, rotationInterval, clobTokenIdsByOutcome if applicable).                                                                                                           |
| GET    | `/api/markets`                     | List all configured markets and active id.                                                                                                                                                                                                               |
| POST   | `/api/market/switch`               | Body: `{ marketId }`. Switches active market, re-subscribes WS, returns new market info.                                                                                                                                                                 |
| GET    | `/api/candles/:outcome/:timeframe` | Query: `limit` (default 500). Returns `{ candles }` for outcome (1s from DB or aggregated 1m/5m/15m/1h from 1s; fallback to Polymarket history for non-1s if no DB data). Outcome is normalized (e.g. `up`, `down`). Timeframe: 1s, 1m, 5m, 15m, 1h, 1w. |
| GET    | `/api/settlement/partner-address`  | Returns settlement partner address and network (env or defaults).                                                                                                                                                                                        |
| POST   | `/api/payment`                     | Body: userAddress, amount, optional orderId, timestamp. Logs and can record payment if DB enabled.                                                                                                                                                       |
| GET    | `/api/polymarket/events/:slug`     | Proxy to Gamma API event by slug.                                                                                                                                                                                                                        |
| GET    | `/api/polymarket/prices-history`   | Query: `market`, `interval`, `fidelity`. Proxy to CLOB prices-history.                                                                                                                                                                                   |

---

## WebSocket

- **URL:** Same host as HTTP; port is `PORT` (two-port mode) or same as HTTP when `USE_SINGLE_PORT`/production.
- **On connect:** Server sends a `connected` message with current market (id, type, slug, title, image, assetIds, outcomes, optional clobTokenIdsByOutcome), then sends latest orderbook snapshot per outcome as `orderbook_update`.
- **Client → server:** `ping` → server responds with `pong`.
- **Server → client:**
  - `connected` – initial market info.
  - `market_changed` – after market switch or rotation (assetIds, outcomes, title, image, slug, marketType, optional clobTokenIdsByOutcome).
  - `orderbook_update` – outcome, outcome_label, asset_id, bids, asks, timestamp.
  - `candle_update` – outcome, timeframe, candle (time, open, high, low, close, volume).
  - `last_trade` – outcome, price, size, side, etc.
  - `tick_size_change` – outcome, old/new tick size.

---

## Database (Supabase)

- **Optional.** If `SUPABASE_URL` and a key are set, `DB_ENABLED` is true.
- **Table used for candles:** `market_candles_1s` (expected columns: `market_id`, `ts`, `open`, `high`, `low`, `close`, `volume`; unique on `(market_id, ts)`). The repo’s migration may define a different table name; ensure a table matching this schema exists (e.g. `market_candles_1s`) for candle persistence.
- **Writes:** 1s candles are upserted via a queue to avoid out-of-order writes; only the latest candle per outcome/timeframe is written when the ticker advances.
- **Reads:** GET `/api/candles/:outcome/:timeframe` uses 1s rows for `timeframe=1s` and aggregates them for 1m/5m/15m/1h when DB is enabled.

---

## Deployment

- **Railway:** `railway.json` and `Procfile` (`web: node server.js`). Single process runs both HTTP and WebSocket; typically one port.
- **Ports:** In production or when `USE_SINGLE_PORT` is set, one port serves both Express and WebSocket. Otherwise `HTTP_PORT` and `PORT` can be used for separate listeners.

---

## Shutdown

On `SIGINT`/`SIGTERM`, the server:

1. Sets `isShuttingDown` and flushes in-memory candles to DB, then waits for queued candle saves (with timeout).
2. Closes the Polymarket WebSocket.
3. Closes the WebSocket server and HTTP server, then exits.

---

## Adding a new market

1. Add a new object to `MARKET_CONFIGS` in `config/marketConfig.js` with `id`, `type`, and either static `slug` or `dynamicSlug` + `slugGenerator` (and optional `timezone`, `rotationInterval`, `outcomeMapping`).
2. Deploy and set `DEFAULT_MARKET` to the new `id`, or switch at runtime with `POST /api/market/switch` and body `{ "marketId": "your-new-id" }`.

---

## Scripts

- `npm start` – run server (`node server.js`).
- `npm run dev` – run with `node --watch server.js` for development.
