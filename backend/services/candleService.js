import {
  TIMEFRAMES,
  AGGREGATABLE_TIMEFRAMES,
  DEBUG_CANDLE_GAPS,
  CANDLE_TICK_INTERVAL_MS,
} from "../config/marketConfig.js";
import {
  getOrderBookState,
  getCandleState,
  getCurrentAssetIds,
  getCurrentOutcomes,
  getCandleSaveQueue,
} from "./state.js";
import { broadcast } from "./broadcastService.js";
import { supabase, DB_ENABLED } from "./db.js";

/**
 * Get current price (best bid or best ask) for an outcome from orderbook state
 */
export function getCurrentPrice(outcomeKey) {
  const orderBookState = getOrderBookState();
  const state = orderBookState[outcomeKey];
  if (!state) return null;

  const bids = Array.from(state.bids.entries());
  const asks = Array.from(state.asks.entries());

  if (bids.length === 0 && asks.length === 0) return null;

  if (asks.length > 0) {
    return Math.min(...asks.map(([price]) => price));
  }
  return Math.max(...bids.map(([price]) => price));
}

/**
 * Save candle to Supabase (if enabled)
 */
export async function saveCandle(outcomeKey, timeframe, candle) {
  if (!DB_ENABLED) {
    // Only log in debug mode
    if (process.env.DEBUG_CANDLES === "true") {
      // console.log(
      //   `📝 Candle created (in-memory): ${outcomeKey} ${timeframe} - O:${candle.open.toFixed(
      //     3,
      //   )} H:${candle.high.toFixed(3)} L:${candle.low.toFixed(
      //     3,
      //   )} C:${candle.close.toFixed(3)}`,
      // );
    }
    return;
  }

  // TEMPORARY: Skip BTC candle writes to save database space
  const currentOutcomes = getCurrentOutcomes();
  const currentAssetIds = getCurrentAssetIds();
  const outcomeIndex = currentOutcomes.findIndex(
    (o) => o.toLowerCase().replace(/\s+/g, "_") === outcomeKey,
  );
  const assetId = currentAssetIds[outcomeIndex];

  // Check if this is a BTC market by checking the market config
  const { getActiveMarketConfig } = await import("../config/marketConfig.js");
  const activeMarket = getActiveMarketConfig();
  if (activeMarket.id === "bitcoin") {
    // Skip saving BTC candles to DB
    if (process.env.DEBUG_CANDLES === "true") {
      // console.log(`⏸️  Skipping BTC candle save: ${outcomeKey} ${timeframe}`);
    }
    return;
  }

  try {
    const marketId = assetId || "unknown";
    let error = null;

    // market_candles_1s table - commented out
    // if (timeframe === "1s") {
    //   const result = await supabase.from("market_candles_1s").upsert(
    //     {
    //       market_id: marketId,
    //       ts: new Date(candle.openTime).toISOString(),
    //       open: candle.open,
    //       high: candle.high,
    //       low: candle.low,
    //       close: candle.close,
    //       volume: candle.volume,
    //     },
    //     {
    //       onConflict: "market_id,ts",
    //     },
    //   );
    //   error = result.error;
    // }

    if (error) {
      // console.error(
      //   `❌ Error saving ${timeframe} candle for ${outcomeKey}:`,
      //   error.message,
      // );
    } else if (process.env.DEBUG_CANDLES === "true") {
      // console.log(
      //   `💾 Saved ${timeframe} candle for ${outcomeKey}: O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close}`,
      // );
    }
  } catch (error) {
    // Error saving candle
  }
}

/**
 * Queue candle saves to avoid out-of-order writes while keeping the latest state.
 */
export function queueSaveCandle(outcomeKey, timeframe, candle) {
  if (!DB_ENABLED) return;

  const candleSaveQueue = getCandleSaveQueue();
  const key = `${outcomeKey}:${timeframe}`;
  const entry = candleSaveQueue.get(key) || { inFlight: false, latest: null };

  entry.latest = {
    openTime: candle.openTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };

  if (entry.inFlight) {
    candleSaveQueue.set(key, entry);
    return;
  }

  entry.inFlight = true;
  candleSaveQueue.set(key, entry);

  (async () => {
    while (entry.latest) {
      const snapshot = entry.latest;
      entry.latest = null;
      try {
        await saveCandle(outcomeKey, timeframe, snapshot);
      } catch (error) {
        // Error saving candle
      }
    }
    entry.inFlight = false;
  })();
}

/**
 * Initialize or update candle
 */
export function updateCandle(outcomeKey, timeframe, price, volume) {
  if (!price || price <= 0) return;

  const candleState = getCandleState();
  if (!candleState[outcomeKey]) return;

  const now = Date.now();
  const timeframeMs = TIMEFRAMES[timeframe];
  const candleStartTime = Math.floor(now / timeframeMs) * timeframeMs;

  let candle = candleState[outcomeKey][timeframe];

  if (!candle || candle.openTime !== candleStartTime) {
    if (candle && candle.openTime < candleStartTime) {
      if (DEBUG_CANDLE_GAPS) {
        const delta = candleStartTime - candle.openTime;
        if (delta > timeframeMs) {
          const missing = Math.max(0, Math.floor(delta / timeframeMs) - 1);
          const lastIso = new Date(candle.openTime).toISOString();
          const nextIso = new Date(candleStartTime).toISOString();
          // console.warn(
          //   `⚠️ Candle gap: ${outcomeKey} ${timeframe} missing ${missing} ` +
          //     `(${lastIso} -> ${nextIso})`,
          // );
        }
      }
      saveCandle(outcomeKey, timeframe, candle).catch(() => {});
    } else if (
      candle &&
      candle.openTime > candleStartTime &&
      DEBUG_CANDLE_GAPS
    ) {
      const lastIso = new Date(candle.openTime).toISOString();
      const nextIso = new Date(candleStartTime).toISOString();
      // console.warn(
      //   `⚠️ Candle time moved backwards for ${outcomeKey} ${timeframe} ` +
      //     `(${lastIso} -> ${nextIso})`,
      // );
    }

    candle = {
      openTime: candleStartTime,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: volume || 0,
    };
    candleState[outcomeKey][timeframe] = candle;
  } else {
    candle.high = Math.max(candle.high, price);
    candle.low = Math.min(candle.low, price);
    candle.close = price;
    candle.volume += volume || 0;
  }

  broadcast({
    type: "candle_update",
    outcome: outcomeKey,
    timeframe,
    candle: {
      time: candle.openTime / 1000,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    },
  });

  // market_candles_1s table - commented out
  // if (timeframe === "1s") {
  //   queueSaveCandle(outcomeKey, timeframe, candle);
  // }
}

/**
 * Process price updates for candle aggregation
 */
export function processPriceForCandles(outcomeKey) {
  const price = getCurrentPrice(outcomeKey);
  if (!price) return;

  const orderBookState = getOrderBookState();
  const state = orderBookState[outcomeKey];
  if (!state) return;

  const volume =
    Array.from(state.bids.values()).reduce((sum, size) => sum + size, 0) +
    Array.from(state.asks.values()).reduce((sum, size) => sum + size, 0);

  Object.keys(TIMEFRAMES).forEach((timeframe) => {
    updateCandle(outcomeKey, timeframe, price, volume);
  });
}

function getBucketStartMs(timestampMs, bucketSeconds) {
  return (
    Math.floor(timestampMs / (bucketSeconds * 1000)) * bucketSeconds * 1000
  );
}

/**
 * Fetch aggregated candles from 1s candles in DB
 * market_candles_1s table - commented out
 */
export async function fetchAggregatedCandlesFrom1s(marketId, timeframe, limit) {
  if (!DB_ENABLED || !supabase) throw new Error("DB not enabled");

  // const bucketSeconds = TIMEFRAMES[timeframe] / 1000;
  // const fetchLimit = Math.max(limit * bucketSeconds, limit);

  // const { data, error } = await supabase
  //   .from("market_candles_1s")
  //   .select("ts, open, high, low, close, volume")
  //   .eq("market_id", marketId)
  //   .order("ts", { ascending: false })
  //   .limit(fetchLimit);

  // if (error) throw error;

  // const ordered = data.reverse();
  // const buckets = new Map();

  // for (const candle of ordered) {
  //   const tsMs = new Date(candle.ts).getTime();
  //   const bucketStart = getBucketStartMs(tsMs, bucketSeconds);
  //   const existing = buckets.get(bucketStart);

  //   if (!existing) {
  //     buckets.set(bucketStart, {
  //       time: Math.floor(bucketStart / 1000),
  //       open: Number(candle.open),
  //       high: Number(candle.high),
  //       low: Number(candle.low),
  //       close: Number(candle.close),
  //       volume: Number(candle.volume),
  //       lastTs: tsMs,
  //     });
  //     continue;
  //   }

  //   existing.high = Math.max(existing.high, Number(candle.high));
  //   existing.low = Math.min(existing.low, Number(candle.low));
  //   if (tsMs >= existing.lastTs) {
  //     existing.close = Number(candle.close);
  //     existing.lastTs = tsMs;
  //   }
  //   existing.volume += Number(candle.volume);
  // }

  // const aggregated = Array.from(buckets.values())
  //   .sort((a, b) => a.time - b.time)
  //   .slice(-limit)
  //   .map(({ lastTs, ...rest }) => rest);

  // return aggregated;
  return [];
}

/**
 * Flush in-memory candles to the database (best-effort).
 */
export async function flushInMemoryCandles() {
  if (!DB_ENABLED) return;

  const candleState = getCandleState();
  const tasks = [];
  const outcomeKeys = Object.keys(candleState);

  for (const outcomeKey of outcomeKeys) {
    for (const timeframe of Object.keys(TIMEFRAMES)) {
      const candle = candleState[outcomeKey][timeframe];
      if (candle) {
        tasks.push(saveCandle(outcomeKey, timeframe, candle));
      }
    }
  }

  await Promise.allSettled(tasks);
}

/**
 * Waits for queued candle writes to complete (best-effort).
 */
export async function waitForQueuedSaves(timeoutMs = 5000) {
  const candleSaveQueue = getCandleSaveQueue();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hasPending = Array.from(candleSaveQueue.values()).some(
      (entry) => entry.inFlight || entry.latest,
    );
    if (!hasPending) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export { TIMEFRAMES, AGGREGATABLE_TIMEFRAMES, CANDLE_TICK_INTERVAL_MS };
