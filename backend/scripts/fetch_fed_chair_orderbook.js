#!/usr/bin/env node

/**
 * Fetch CLOB orderbook data for "who-will-trump-nominate-as-fed-chair".
 *
 * Data sources (tried in order):
 *   1. Rust orderbook HTTP API (Railway) — live in-memory orderbook
 *   2. Rust server's Supabase DB — persisted orders/trades
 *
 * Usage:
 *   node backend/scripts/fetch_fed_chair_orderbook.js                          # snapshot from API
 *   node backend/scripts/fetch_fed_chair_orderbook.js --db                     # query Supabase DB directly
 *   node backend/scripts/fetch_fed_chair_orderbook.js --trades                 # include recent trades
 *   node backend/scripts/fetch_fed_chair_orderbook.js --all                    # everything
 *   node backend/scripts/fetch_fed_chair_orderbook.js --outcome "Kevin Warsh"  # filter by outcome
 */

import { createClient } from "@supabase/supabase-js";

// --- Config ---
const API_URL =
  process.env.ORDERBOOK_API_URL || "https://perporderbook-production.up.railway.app";

// Rust server's Supabase (from orderbook-rs/server/.env)
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const SYMBOL_PREFIX = "WHO-WILL-TRUMP-NOMINATE-AS-FED-CHAIR";

const OUTCOMES = [
  "Kevin Warsh", "Kevin Hassett", "Christopher Waller", "Bill Pulte",
  "Judy Shelton", "David Malpass", "Howard Lutnick", "Arthur Laffer",
  "Larry Kudlow", "Jerome Powell", "Ron Paul", "Stephen Miran",
  "Scott Bessent", "James Bullard", "Marc Sumerlin", "David Zervos",
  "Rick Rieder", "Michelle Bowman", "Lorie K. Logan", "Philip Jefferson",
  "Janet Yellen", "Larry Lindsey", "Barron Trump", "Donald Trump",
  "nominate no one before 2027",
];

// --- Symbol generation (mirrors frontend clobSymbols.ts) ---
function outcomeKeyToAbbr(outcomeKey) {
  const isYes = outcomeKey.endsWith("_yes");
  const isNo = outcomeKey.endsWith("_no");
  const yesNoSuffix = isYes ? "-YES" : isNo ? "-NO" : "";
  const base = outcomeKey.replace(/_yes$|_no$/, "").trim();
  if (!base) return outcomeKey.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 3) + yesNoSuffix;
  const parts = base.split("_").filter(Boolean);
  let teamAbbr;
  if (parts.length >= 2) {
    teamAbbr = parts.map((p) => p[0]).join("").toUpperCase().substring(0, 3);
  } else {
    teamAbbr = base.substring(0, 3).toUpperCase();
  }
  return teamAbbr + yesNoSuffix;
}

function generateSymbol(outcome) {
  const key = outcome.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "");
  const abbr = outcomeKeyToAbbr(key);
  return `${SYMBOL_PREFIX}-${abbr}`;
}

function formatPrice(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

// ============================================================
// Source 1: Rust Orderbook HTTP API (live in-memory state)
// ============================================================

async function fetchFromAPI(symbolFilter) {
  // First list all orderbooks on the server
  const listRes = await fetch(`${API_URL}/orderbooks`);
  if (!listRes.ok) throw new Error(`API list failed: ${listRes.status}`);
  const { orderbooks } = await listRes.json();

  // Filter to fed-chair symbols
  const fedChairBooks = orderbooks.filter((s) =>
    symbolFilter ? s === symbolFilter : s.startsWith(SYMBOL_PREFIX)
  );

  if (!fedChairBooks.length) {
    console.log(`\n  No fed-chair orderbooks found on the live API.`);
    console.log(`  Available orderbooks: ${orderbooks.join(", ") || "(none)"}`);
    console.log(`  The market may not be active. Use --db to query the database instead.\n`);
    return { snapshots: [], trades: [] };
  }

  const snapshots = [];
  const allTrades = [];

  for (const symbol of fedChairBooks) {
    // Fetch orderbook snapshot
    try {
      const snapRes = await fetch(`${API_URL}/orderbooks/${encodeURIComponent(symbol)}/snapshot`);
      if (snapRes.ok) {
        const snap = await snapRes.json();
        snapshots.push({ symbol, ...snap });
      }
    } catch (e) {
      console.error(`  Failed to fetch snapshot for ${symbol}: ${e.message}`);
    }

    // Fetch trades
    try {
      const tradeRes = await fetch(`${API_URL}/orderbooks/${encodeURIComponent(symbol)}/trades?limit=20`);
      if (tradeRes.ok) {
        const tradeData = await tradeRes.json();
        const trades = tradeData.trades || tradeData;
        if (Array.isArray(trades)) {
          allTrades.push(...trades.map((t) => ({ ...t, symbol })));
        }
      }
    } catch (e) {
      // trades endpoint may not exist
    }

    // Fetch all active orders
    try {
      const ordersRes = await fetch(`${API_URL}/orderbooks/${encodeURIComponent(symbol)}/orders/all`);
      if (ordersRes.ok) {
        const ordersData = await ordersRes.json();
        const orders = ordersData.orders || ordersData;
        if (Array.isArray(orders) && orders.length) {
          const existing = snapshots.find((s) => s.symbol === symbol);
          if (existing) existing.allOrders = orders;
        }
      }
    } catch (e) {
      // optional
    }
  }

  return { snapshots, trades: allTrades };
}

function printAPISnapshots(snapshots) {
  for (const snap of snapshots) {
    console.log(`\n  Symbol: ${snap.symbol}`);
    console.log(`  ${"─".repeat(70)}`);

    const bids = snap.bids || [];
    const asks = snap.asks || [];

    if (bids.length) {
      console.log(`  BIDS (${bids.length} levels):`);
      for (const [price, qty] of bids.slice(0, 10)) {
        console.log(`    ${formatPrice(price).padEnd(10)} qty: ${qty}`);
      }
      if (bids.length > 10) console.log(`    ... and ${bids.length - 10} more levels`);
    }

    if (asks.length) {
      console.log(`  ASKS (${asks.length} levels):`);
      for (const [price, qty] of asks.slice(0, 10)) {
        console.log(`    ${formatPrice(price).padEnd(10)} qty: ${qty}`);
      }
      if (asks.length > 10) console.log(`    ... and ${asks.length - 10} more levels`);
    }

    if (!bids.length && !asks.length) console.log("    (empty book)");

    if (snap.allOrders) {
      console.log(`  Active orders: ${snap.allOrders.length}`);
    }
  }
}

// ============================================================
// Source 2: Supabase DB (persisted orders/trades)
// ============================================================

async function fetchFromDB(symbolFilter, includeTrades) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Check if orders table exists
  let orders = [];
  let trades = [];

  try {
    let query = supabase
      .from("orders")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (symbolFilter) {
      query = query.eq("symbol", symbolFilter);
    } else {
      query = query.like("symbol", `${SYMBOL_PREFIX}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    orders = data || [];
  } catch (e) {
    console.log(`  Orders table: ${e.message}`);
  }

  if (includeTrades) {
    try {
      let query = supabase
        .from("trades")
        .select("*")
        .order("executed_at", { ascending: false })
        .limit(50);

      if (symbolFilter) {
        query = query.eq("symbol", symbolFilter);
      } else {
        query = query.like("symbol", `${SYMBOL_PREFIX}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      trades = data || [];
    } catch (e) {
      console.log(`  Trades table: ${e.message}`);
    }
  }

  return { orders, trades };
}

function printDBOrders(orders) {
  if (!orders.length) {
    console.log("  (no active orders)\n");
    return;
  }

  const bySymbol = {};
  for (const o of orders) {
    (bySymbol[o.symbol] ||= []).push(o);
  }

  for (const [symbol, symbolOrders] of Object.entries(bySymbol)) {
    console.log(`\n  Symbol: ${symbol}`);
    console.log(`  ${"─".repeat(80)}`);

    const bids = symbolOrders.filter((o) => o.side === "buy").sort((a, b) => b.price - a.price);
    const asks = symbolOrders.filter((o) => o.side === "sell").sort((a, b) => a.price - b.price);

    if (bids.length) {
      console.log(`  BIDS (${bids.length}):`);
      for (const b of bids.slice(0, 10)) {
        console.log(`    ${formatPrice(b.price)}  qty: ${b.remaining_quantity}  type: ${b.order_type}  wallet: ${b.wallet_address.slice(0, 8)}...`);
      }
      if (bids.length > 10) console.log(`    ... and ${bids.length - 10} more bids`);
    }

    if (asks.length) {
      console.log(`  ASKS (${asks.length}):`);
      for (const a of asks.slice(0, 10)) {
        console.log(`    ${formatPrice(a.price)}  qty: ${a.remaining_quantity}  type: ${a.order_type}  wallet: ${a.wallet_address.slice(0, 8)}...`);
      }
      if (asks.length > 10) console.log(`    ... and ${asks.length - 10} more asks`);
    }

    if (!bids.length && !asks.length) console.log("    (empty book)");
  }
  console.log();
}

function printTrades(trades) {
  if (!trades.length) {
    console.log("  (no recent trades)\n");
    return;
  }

  console.log(`  ${"─".repeat(90)}`);
  console.log(`  ${"Time".padEnd(24)} ${"Symbol".padEnd(40)} ${"Side".padEnd(6)} ${"Price".padEnd(10)} Qty`);
  console.log(`  ${"─".repeat(90)}`);

  for (const t of trades) {
    const timeField = t.executed_at || t.timestamp || "";
    const time = timeField ? new Date(timeField).toISOString().replace("T", " ").slice(0, 19) : "N/A";
    const symbol = (t.symbol || "").padEnd(40);
    const side = (t.side || t.taker_side || "?").padEnd(6);
    console.log(`  ${time.padEnd(24)} ${symbol} ${side} ${formatPrice(t.price).padEnd(10)} ${t.quantity}`);
  }
  console.log();
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const useDB = args.includes("--db");
  const showTrades = args.includes("--trades");
  const showAll = args.includes("--all");

  const outcomeIdx = args.indexOf("--outcome");
  let symbolFilter = null;
  let outcomeName = null;
  if (outcomeIdx !== -1 && args[outcomeIdx + 1]) {
    outcomeName = args[outcomeIdx + 1];
    symbolFilter = generateSymbol(outcomeName);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Fed Chair Market - CLOB Orderbook Data`);
  console.log(`  Slug: who-will-trump-nominate-as-fed-chair`);
  console.log(`  Symbol prefix: ${SYMBOL_PREFIX}`);
  if (symbolFilter) console.log(`  Filter: "${outcomeName}" -> ${symbolFilter}`);
  console.log(`  Source: ${useDB ? "Supabase DB" : "Live API"} (${useDB ? SUPABASE_URL : API_URL})`);
  console.log(`${"=".repeat(60)}`);

  // Print outcome -> symbol mapping
  if (!symbolFilter) {
    console.log("\nOutcome -> Symbol mapping:");
    for (const o of OUTCOMES) {
      console.log(`  ${o.padEnd(30)} -> ${generateSymbol(o)}`);
    }
  }

  if (useDB) {
    // --- Database mode ---
    console.log("\nQuerying Supabase DB...");
    const { orders, trades } = await fetchFromDB(symbolFilter, showTrades || showAll);

    console.log(`\nACTIVE ORDERS: ${orders.length}`);
    printDBOrders(orders);

    if ((showTrades || showAll) && trades.length) {
      console.log(`\nRECENT TRADES: ${trades.length}`);
      printTrades(trades);
    }
  } else {
    // --- API mode ---
    console.log("\nQuerying live orderbook API...");
    const { snapshots, trades } = await fetchFromAPI(symbolFilter);

    if (snapshots.length) {
      console.log(`\nORDERBOOK SNAPSHOTS: ${snapshots.length} symbols`);
      printAPISnapshots(snapshots);
    }

    if ((showTrades || showAll) && trades.length) {
      console.log(`\nRECENT TRADES: ${trades.length}`);
      printTrades(trades);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
