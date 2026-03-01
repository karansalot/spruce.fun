import { WebSocket } from "ws";
import { TIMEFRAMES, getActiveMarketConfig } from "../config/marketConfig.js";
import {
  getOrderBookState,
  setOrderBookState,
  getCandleState,
  setCandleState,
  getCurrentAssetIds,
  getCurrentOutcomes,
} from "./state.js";
import { broadcast } from "./broadcastService.js";
import {
  processPriceForCandles,
  updateCandle,
  getCurrentPrice,
} from "./candleService.js";
import { fetchInitialOrderbook } from "./polymarketApiService.js";

/**
 * Initialize orderbook and candle state for given outcomes
 */
export function initializeMarketState(outcomes) {
  let orderBookState = {};
  let candleState = {};

  outcomes.forEach((outcome) => {
    const outcomeKey = outcome.toLowerCase().replace(/\s+/g, "_");
    orderBookState[outcomeKey] = {
      bids: new Map(),
      asks: new Map(),
    };
    candleState[outcomeKey] = {
      "1s": null,
      "1m": null,
      "5m": null,
      "15m": null,
      "1h": null,
    };
  });

  setOrderBookState(orderBookState);
  setCandleState(candleState);
}

/**
 * Clear all market state
 */
export function clearMarketState() {
  const orderBookState = getOrderBookState();
  Object.keys(orderBookState).forEach((key) => {
    orderBookState[key].bids.clear();
    orderBookState[key].asks.clear();
  });
}

/**
 * Process orderbook update from Polymarket
 */
export function processOrderBookUpdate(data) {
  const currentAssetIds = getCurrentAssetIds();
  const currentOutcomes = getCurrentOutcomes();
  const orderBookState = getOrderBookState();
  const marketConfig = getActiveMarketConfig();

  if (data.event_type === "tick_size_change") {
    const assetIndex = currentAssetIds.indexOf(data.asset_id);
    if (assetIndex === -1) return;

    const outcome = currentOutcomes[assetIndex];
    if (process.env.DEBUG_ORDERBOOK === 'true') {
      console.log(
        `📏 Tick size change: ${outcome.toUpperCase()} - ${
          data.old_tick_size
        } → ${data.new_tick_size}`
      );
    }

    broadcast({
      type: "tick_size_change",
      outcome: outcome.toLowerCase().replace(/\s+/g, "_"),
      outcome_label: outcome,
      asset_id: data.asset_id,
      old_tick_size: data.old_tick_size,
      new_tick_size: data.new_tick_size,
      timestamp: data.timestamp || Date.now(),
    });
    return;
  }

  if (data.event_type === "last_trade_price") {
    const assetIndex = currentAssetIds.indexOf(data.asset_id);
    if (assetIndex === -1) return;

    const outcome = currentOutcomes[assetIndex];
    const outcomeKey = outcome.toLowerCase().replace(/\s+/g, "_");

    if (process.env.DEBUG_TRADES === 'true') {
      console.log(
        `💱 Trade: ${outcome.toUpperCase()} - ${data.side} ${data.size} @ ${
          data.price
        }`
      );
    }

    broadcast({
      type: "last_trade",
      outcome: outcomeKey,
      outcome_label: outcome,
      asset_id: data.asset_id,
      price: data.price,
      size: data.size,
      side: data.side,
      fee_rate_bps: data.fee_rate_bps,
      timestamp: data.timestamp || Date.now(),
    });

    const price = Number(data.price);
    const volume = Number(data.size);
    if (price > 0 && volume > 0) {
      Object.keys(TIMEFRAMES).forEach((timeframe) => {
        updateCandle(outcomeKey, timeframe, price, volume);
      });
    }
    return;
  }

  if (!data.asset_id) return;

  const assetIndex = currentAssetIds.indexOf(data.asset_id);
  if (assetIndex === -1) return;

  const outcome = currentOutcomes[assetIndex];
  const outcomeKey = outcome.toLowerCase().replace(/\s+/g, "_");
  const state = orderBookState[outcomeKey];

  if (!state) return;

  if (data.event_type === "price_change" && data.price_changes) {
    if (process.env.DEBUG_ORDERBOOK === 'true') {
      console.log(
        `📊 Price change: ${outcome.toUpperCase()} - ${
          data.price_changes.length
        } changes`
      );
    }
    data.price_changes.forEach((change) => {
      const price = Number(change.price);
      const size = Number(change.size);

      if (change.side === "BUY") {
        if (size > 0) {
          state.bids.set(price, size);
        } else {
          state.bids.delete(price);
        }
      } else if (change.side === "SELL") {
        if (size > 0) {
          state.asks.set(price, size);
        } else {
          state.asks.delete(price);
        }
      }
    });

    const updateMessage = {
      type: "orderbook_update",
      outcome: outcomeKey,
      outcome_label: outcome,
      asset_id: data.asset_id,
      bids: Array.from(state.bids.entries())
        .map(([price, size]) => ({ price, size }))
        .sort((a, b) => b.price - a.price),
      asks: Array.from(state.asks.entries())
        .map(([price, size]) => ({ price, size }))
        .sort((a, b) => a.price - b.price),
      timestamp: Date.now(),
    };
    broadcast(updateMessage);
    processPriceForCandles(outcomeKey);
    return;
  }

  if (data.bids || data.asks) {
    if (process.env.DEBUG_ORDERBOOK === 'true') {
      console.log(
        `📸 Full snapshot: ${outcome.toUpperCase()} - Bids: ${
          data.bids?.length || 0
        }, Asks: ${data.asks?.length || 0}`
      );
    }

    if (data.bids && Array.isArray(data.bids)) {
      state.bids.clear();
      data.bids.forEach((bid) => {
        const price = Array.isArray(bid) ? Number(bid[0]) : Number(bid.price);
        const size = Array.isArray(bid) ? Number(bid[1]) : Number(bid.size);
        if (price > 0 && size > 0) {
          state.bids.set(price, size);
        }
      });
    }

    if (data.asks && Array.isArray(data.asks)) {
      state.asks.clear();
      data.asks.forEach((ask) => {
        const price = Array.isArray(ask) ? Number(ask[0]) : Number(ask.price);
        const size = Array.isArray(ask) ? Number(ask[1]) : Number(ask.size);
        if (price > 0 && size > 0) {
          state.asks.set(price, size);
        }
      });
    }

    const updateMessage = {
      type: "orderbook_update",
      outcome: outcomeKey,
      outcome_label: outcome,
      asset_id: data.asset_id,
      bids: Array.from(state.bids.entries())
        .map(([price, size]) => ({ price, size }))
        .sort((a, b) => b.price - a.price),
      asks: Array.from(state.asks.entries())
        .map(([price, size]) => ({ price, size }))
        .sort((a, b) => a.price - b.price),
      timestamp: Date.now(),
    };

    broadcast(updateMessage);
    processPriceForCandles(outcomeKey);
  }
}

/**
 * Load initial orderbooks for all assets
 */
export async function loadInitialOrderbooks() {
  const currentAssetIds = getCurrentAssetIds();
  const currentOutcomes = getCurrentOutcomes();

  for (let i = 0; i < currentAssetIds.length; i++) {
    const assetId = currentAssetIds[i];
    const orderbook = await fetchInitialOrderbook(assetId);
    if (orderbook && (orderbook.bids || orderbook.asks)) {
      processOrderBookUpdate({
        asset_id: assetId,
        bids: orderbook.bids || [],
        asks: orderbook.asks || [],
      });
    }
  }
}

export { getCurrentPrice };
