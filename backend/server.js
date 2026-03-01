import "./loadEnv.js"; // Must be first - loads .env before db.js reads process.env
import { WebSocketServer, WebSocket } from "ws";
import https from "https";
import express from "express";
import cors from "cors";
import { createServer } from "http";

const PORT = process.env.PORT || 8080;
const HTTP_PORT = process.env.HTTP_PORT || 8081;

// CORS configuration - allow all origins in production (Railway/Vercel)
const corsOptions = {
  origin:
    process.env.NODE_ENV === "production"
      ? true
      : ["http://localhost:3000", "http://127.0.0.1:3000"],
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// ---------------------------------------------------------------------------
// Imports from config and services
// ---------------------------------------------------------------------------
import {
  MARKET_CONFIGS,
  getActiveMarketConfig,
  setActiveMarketConfig,
} from "./config/marketConfig.js";
import {
  getOrderBookState,
  getCurrentAssetIds,
  getCurrentOutcomes,
  getClobTokenIdsByOutcome,
  getCurrentMarketMetadata,
  getClients,
  getPolymarketWs,
  getIsShuttingDown,
  setIsShuttingDown,
} from "./services/state.js";
import { supabase, DB_ENABLED } from "./services/db.js";
import { initialize } from "./services/initService.js";
import { updateMarketSubscription } from "./services/polymarketWsService.js";
import {
  flushInMemoryCandles,
  waitForQueuedSaves,
} from "./services/candleService.js";
import { fetchPricesHistoryByInterval } from "./services/polymarketApiService.js";

// ---------------------------------------------------------------------------
// Express app and HTTP routes
// ---------------------------------------------------------------------------
const app = express();
app.use(cors(corsOptions));
app.use(express.json());

/** Allowed intervals for Polymarket CLOB prices-history (see docs.polymarket.com/developers/CLOB/timeseries) */
const CANDLE_INTERVALS = ["1m", "1h", "6h", "1d", "1w", "max"];

/**
 * GET /api/candles/:outcome/:timeframe
 * Fetch historical price data from Polymarket CLOB timeseries API.
 * Timeframe must be one of: 1m, 1h, 6h, 1d, 1w, max
 */
app.get("/api/candles/:outcome/:timeframe", async (req, res) => {
  try {
    const { outcome, timeframe } = req.params;
    const outcomeKey = outcome.toLowerCase().replace(/\s+/g, "_");
    const orderBookState = getOrderBookState();
    const currentOutcomes = getCurrentOutcomes();
    const currentAssetIds = getCurrentAssetIds();

    if (!orderBookState[outcomeKey]) {
      return res.status(400).json({
        error: `Invalid outcome '${outcome}'. Available: ${Object.keys(
          orderBookState,
        ).join(", ")}`,
      });
    }

    if (!CANDLE_INTERVALS.includes(timeframe)) {
      return res.status(400).json({
        error: `Invalid timeframe. Must be one of: ${CANDLE_INTERVALS.join(
          ", ",
        )}`,
      });
    }

    const outcomeIndex = currentOutcomes.findIndex(
      (o) => o.toLowerCase().replace(/\s+/g, "_") === outcomeKey,
    );
    const marketId = currentAssetIds[outcomeIndex];
    if (!marketId) {
      return res.json({ candles: [] });
    }

    const result = await fetchPricesHistoryByInterval(marketId, timeframe);
    const history = result?.history || [];
    const candles = history
      .map((point) => ({
        time: point.t,
        open: point.p,
        high: point.p,
        low: point.p,
        close: point.p,
        volume: 0,
      }))
      .sort((a, b) => a.time - b.time); // oldest first so chart start = range start

    return res.json({ candles });
  } catch (error) {
    console.error("Error fetching candles:", error?.message || error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/health", (req, res) => {
  const activeMarketConfig = getActiveMarketConfig();
  const currentMarketMetadata = getCurrentMarketMetadata();
  const currentAssetIds = getCurrentAssetIds();
  const currentOutcomes = getCurrentOutcomes();
  const clients = getClients();
  const clobTokenIdsByOutcome = getClobTokenIdsByOutcome();

  const marketPayload = {
    id: activeMarketConfig.id,
    type: activeMarketConfig.type,
    slug: currentMarketMetadata.slug,
    title: currentMarketMetadata.title,
    assetIds: currentAssetIds,
    outcomes: currentOutcomes,
  };
  if (clobTokenIdsByOutcome)
    marketPayload.clobTokenIdsByOutcome = clobTokenIdsByOutcome;
  res.json({
    status: "ok",
    connected: clients.size,
    market: marketPayload,
  });
});

app.get("/api/market", (req, res) => {
  const activeMarketConfig = getActiveMarketConfig();
  const currentMarketMetadata = getCurrentMarketMetadata();
  const currentAssetIds = getCurrentAssetIds();
  const currentOutcomes = getCurrentOutcomes();
  const clobTokenIdsByOutcome = getClobTokenIdsByOutcome();

  const payload = {
    id: activeMarketConfig.id,
    type: activeMarketConfig.type,
    slug: currentMarketMetadata.slug,
    title: currentMarketMetadata.title,
    image: currentMarketMetadata.image,
    assetIds: currentAssetIds,
    outcomes: currentOutcomes,
    dynamicSlug: activeMarketConfig.dynamicSlug,
    rotationInterval: activeMarketConfig.rotationInterval,
  };
  if (clobTokenIdsByOutcome)
    payload.clobTokenIdsByOutcome = clobTokenIdsByOutcome;
  res.json(payload);
});

app.get("/api/markets", (req, res) => {
  const activeMarketConfig = getActiveMarketConfig();
  res.json({
    markets: MARKET_CONFIGS.map((config) => ({
      id: config.id,
      type: config.type,
      dynamicSlug: config.dynamicSlug,
      slug: config.dynamicSlug ? null : config.slug,
      rotationInterval: config.rotationInterval,
    })),
    active: activeMarketConfig.id,
  });
});

app.post("/api/market/switch", async (req, res) => {
  try {
    const { marketId } = req.body;

    if (!marketId) {
      return res.status(400).json({ error: "marketId is required" });
    }

    const newMarketConfig = MARKET_CONFIGS.find((m) => m.id === marketId);
    if (!newMarketConfig) {
      return res.status(404).json({ error: "Market not found" });
    }

    const activeMarketConfig = getActiveMarketConfig();
    if (activeMarketConfig.id === marketId) {
      return res.json({ message: "Already on this market" });
    }

    setActiveMarketConfig(newMarketConfig);
    await updateMarketSubscription();

    const currentMarketMetadata = getCurrentMarketMetadata();
    const currentOutcomes = getCurrentOutcomes();

    res.json({
      success: true,
      market: {
        id: newMarketConfig.id,
        type: newMarketConfig.type,
        slug: currentMarketMetadata.slug,
        title: currentMarketMetadata.title,
        outcomes: currentOutcomes,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to switch market" });
  }
});

// Hot wallet: receives and sends amounts for all trades (settlement). Configurable via HOT_WALLET_ADDRESS or YELLOW_PARTNER_ADDRESS.
const HOT_WALLET_ADDRESS_DEFAULT = "0x4CbEe7aD42d33e9D3B41e8b6FAcA2f6f173C8A94";

app.get("/api/yellow/partner-address", (req, res) => {
  const partnerAddress =
    process.env.HOT_WALLET_ADDRESS ||
    process.env.YELLOW_PARTNER_ADDRESS ||
    HOT_WALLET_ADDRESS_DEFAULT;

  res.json({
    partnerAddress,
    network: process.env.YELLOW_NETWORK || "mainnet",
  });
});

/**
 * Store Yellow session key when user connects wallet (for signature-less transactions).
 * Session keys (including private key) stored in DB as source of truth instead of localStorage.
 */
app.post("/api/yellow/session-key", async (req, res) => {
  try {
    const {
      walletAddress,
      sessionKeyAddress,
      sessionKeyPrivateKey,
      expiresAt,
    } = req.body;

    if (
      !walletAddress ||
      !sessionKeyAddress ||
      !sessionKeyPrivateKey ||
      !expiresAt
    ) {
      console.warn("[session-key] Missing required fields:", {
        hasWallet: !!walletAddress,
        hasSessionKey: !!sessionKeyAddress,
        hasPrivateKey: !!sessionKeyPrivateKey,
        hasExpires: !!expiresAt,
      });
      return res.status(400).json({
        error:
          "Missing required fields: walletAddress, sessionKeyAddress, sessionKeyPrivateKey, expiresAt",
      });
    }

    if (!DB_ENABLED || !supabase) {
      console.warn(
        "[session-key] DB not configured - add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to backend .env",
      );
      return res.json({
        success: true,
        stored: false,
        message: "DB not configured - session not persisted",
        timestamp: Date.now(),
      });
    }

    const expiresAtTs = new Date(expiresAt).toISOString();
    const wallet = walletAddress.toLowerCase();

    // Replace any existing session for this wallet
    await supabase
      .from("yellow_session_keys")
      .delete()
      .eq("wallet_address", wallet);

    const { error } = await supabase.from("yellow_session_keys").insert({
      wallet_address: wallet,
      session_key_address: sessionKeyAddress,
      session_key_private_key: sessionKeyPrivateKey,
      expires_at: expiresAtTs,
    });

    if (error) {
      console.error("[session-key] Supabase insert failed:", error);
      return res
        .status(500)
        .json({ error: "Failed to store session key", details: error.message });
    }

    console.log("[session-key] Stored for", wallet.slice(0, 10) + "...");
    res.json({
      success: true,
      stored: true,
      message: "Session key stored",
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[session-key] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/yellow/payment", async (req, res) => {
  try {
    const { userAddress, amount, orderId, timestamp } = req.body;

    if (!userAddress || !amount) {
      return res
        .status(400)
        .json({ error: "Missing required fields: userAddress, amount" });
    }

    console.log(
      `💰 Payment received: ${amount} from ${userAddress} for order ${
        orderId || "N/A"
      }`,
    );

    if (DB_ENABLED) {
      // Example: await supabase.from('payments').insert({ ... });
    }

    res.json({
      success: true,
      message: "Payment recorded",
      timestamp: Date.now(),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to record payment" });
  }
});

app.post("/api/beta/validate", async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    if (!DB_ENABLED || !supabase) {
      console.warn("[beta] DB not configured — accepting code without validation");
      return res.json({ success: true });
    }

    // Find unused code (case-insensitive)
    const { data, error } = await supabase
      .from("beta_access_codes")
      .select("id, code")
      .ilike("code", code.trim())
      .eq("used", false)
      .limit(1)
      .single();

    if (error || !data) {
      return res.status(401).json({ error: "Invalid or already used code" });
    }

    // Mark code as used
    const { error: updateError } = await supabase
      .from("beta_access_codes")
      .update({ used: true, used_at: new Date().toISOString() })
      .eq("id", data.id);

    if (updateError) {
      console.error("[beta] Failed to mark code as used:", updateError);
      return res.status(500).json({ error: "Internal server error" });
    }

    console.log(`[beta] Code ${data.code} redeemed`);
    return res.json({ success: true });
  } catch (error) {
    console.error("[beta] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/polymarket/events/:slug", (req, res) => {
  const { slug } = req.params;
  const url = `https://gamma-api.polymarket.com/events/slug/${slug}`;

  https
    .get(url, (proxyRes) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "application/json");
      let data = "";
      proxyRes.on("data", (chunk) => {
        data += chunk;
      });
      proxyRes.on("end", () => {
        res.send(data);
      });
    })
    .on("error", (error) => {
      res.status(500).json({ error: "Failed to fetch from Polymarket" });
    });
});

/** Proxy to Polymarket CLOB orderbook; params: token_id. */
app.get("/api/polymarket/book", (req, res) => {
  const { token_id } = req.query;

  if (!token_id) {
    return res
      .status(400)
      .json({ error: "token_id parameter is required" });
  }

  const url = `https://clob.polymarket.com/book?token_id=${encodeURIComponent(token_id)}`;

  https
    .get(url, (proxyRes) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "application/json");
      let data = "";
      proxyRes.on("data", (chunk) => {
        data += chunk;
      });
      proxyRes.on("end", () => {
        res.send(data);
      });
    })
    .on("error", (error) => {
      res
        .status(500)
        .json({ error: "Failed to fetch orderbook from Polymarket" });
    });
});

/** Proxy to Polymarket CLOB getPricesHistory; params: market (tokenID), interval, startTs, endTs, fidelity. */
/** Default fidelity per interval so charts get enough points (e.g. 1w → hourly so week isn't a flat line). */
const FIDELITY_BY_INTERVAL = {
  max: "1440", // daily
  "1m": "60", // hourly
  "1w": "60", // hourly for 1 week
  "1d": "60", // hourly for 1 day
  "6h": "30",
  "1h": "15",
};
app.get("/api/polymarket/prices-history", (req, res) => {
  const { market, interval, fidelity, startTs, endTs } = req.query;

  if (!market) {
    return res
      .status(400)
      .json({ error: "market parameter is required (CLOB token ID)" });
  }

  const effectiveInterval = interval || "max";
  const params = new URLSearchParams({ market, interval: effectiveInterval });
  if (fidelity != null && fidelity !== "") {
    params.set("fidelity", String(fidelity));
  } else if (FIDELITY_BY_INTERVAL[effectiveInterval]) {
    params.set("fidelity", FIDELITY_BY_INTERVAL[effectiveInterval]);
  }
  if (startTs != null && startTs !== "") params.set("startTs", String(startTs));
  if (endTs != null && endTs !== "") params.set("endTs", String(endTs));
  const url = `https://clob.polymarket.com/prices-history?${params.toString()}`;

  https
    .get(url, (proxyRes) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "application/json");
      let data = "";
      proxyRes.on("data", (chunk) => {
        data += chunk;
      });
      proxyRes.on("end", () => {
        res.send(data);
      });
    })
    .on("error", (error) => {
      res
        .status(500)
        .json({ error: "Failed to fetch price history from Polymarket" });
    });
});

// ---------------------------------------------------------------------------
// HTTP and WebSocket servers
// ---------------------------------------------------------------------------
const httpServer = createServer(app);

const useSinglePort =
  process.env.NODE_ENV === "production" ||
  process.env.USE_SINGLE_PORT === "true" ||
  (process.env.PORT && !process.env.HTTP_PORT);
const serverPort = useSinglePort ? PORT : HTTP_PORT;

httpServer.listen(serverPort, () => {
  console.log(`\n🌐 HTTP API server listening on port ${serverPort}`);
  console.log(
    `📊 Candles endpoint: http://localhost:${serverPort}/api/candles/:asset/:timeframe`,
  );
  if (useSinglePort) {
    console.log(`🔌 WebSocket will also use port ${serverPort}\n`);
  }
});

const wss = useSinglePort
  ? new WebSocketServer({ server: httpServer })
  : new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  const clients = getClients();
  const activeMarketConfig = getActiveMarketConfig();
  const currentMarketMetadata = getCurrentMarketMetadata();
  const currentAssetIds = getCurrentAssetIds();
  const currentOutcomes = getCurrentOutcomes();
  const clobTokenIdsByOutcome = getClobTokenIdsByOutcome();
  const orderBookState = getOrderBookState();

  clients.add(ws);

  const connectedMarket = {
    id: activeMarketConfig.id,
    type: activeMarketConfig.type,
    slug: currentMarketMetadata.slug,
    title: currentMarketMetadata.title,
    image: currentMarketMetadata.image,
    assetIds: currentAssetIds,
    outcomes: currentOutcomes,
  };
  if (clobTokenIdsByOutcome)
    connectedMarket.clobTokenIdsByOutcome = clobTokenIdsByOutcome;
  ws.send(
    JSON.stringify({
      type: "connected",
      market: connectedMarket,
      timestamp: Date.now(),
    }),
  );

  Object.keys(orderBookState).forEach((outcomeKey, index) => {
    const state = orderBookState[outcomeKey];
    const outcome = currentOutcomes.find(
      (o) => o.toLowerCase().replace(/\s+/g, "_") === outcomeKey,
    );

    ws.send(
      JSON.stringify({
        type: "orderbook_update",
        outcome: outcomeKey,
        outcome_label: outcome,
        asset_id: currentAssetIds[index],
        bids: Array.from(state.bids.entries())
          .map(([price, size]) => ({ price, size }))
          .sort((a, b) => b.price - a.price),
        asks: Array.from(state.asks.entries())
          .map(([price, size]) => ({ price, size }))
          .sort((a, b) => a.price - b.price),
        timestamp: Date.now(),
      }),
    );
  });

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      }
    } catch (error) {
      // Ignore invalid messages
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
  });

  ws.on("error", (error) => {
    clients.delete(ws);
  });
});

if (!useSinglePort) {
  console.log(`\n🌐 WebSocket server listening on port ${PORT}`);
  console.log(`📡 Clients can connect to: ws://localhost:${PORT}\n`);
} else {
  console.log(
    `📡 WebSocket available on same port: wss://localhost:${serverPort}\n`,
  );
}

initialize();

async function shutdown(signal) {
  if (getIsShuttingDown()) return;
  setIsShuttingDown(true);

  try {
    await flushInMemoryCandles();
    await waitForQueuedSaves();
  } catch (error) {
    // Error flushing candles during shutdown
  }

  const polymarketWs = getPolymarketWs();
  if (polymarketWs) {
    polymarketWs.close();
  }

  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => httpServer.close(resolve));

  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
