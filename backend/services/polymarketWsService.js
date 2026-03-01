import { WebSocket } from "ws";
import {
  POLYMARKET_WS_URL,
  getActiveMarketConfig,
  CANDLE_TICK_INTERVAL_MS,
} from "../config/marketConfig.js";
import { getETDateTime } from "./datetimeService.js";
import {
  getCurrentAssetIds,
  setCurrentAssetIds,
  getCurrentOutcomes,
  setCurrentOutcomes,
  getClobTokenIdsByOutcome,
  setClobTokenIdsByOutcome,
  getCurrentMarketMetadata,
  setCurrentMarketMetadata,
  getCurrentHour,
  setCurrentHour,
  getPolymarketWs,
  setPolymarketWs,
  getOrderBookState,
} from "./state.js";
import { broadcast } from "./broadcastService.js";
import { fetchCurrentAssetIds } from "./marketDataService.js";
import {
  initializeMarketState,
  processOrderBookUpdate,
  loadInitialOrderbooks,
} from "./orderbookService.js";
import { processPriceForCandles } from "./candleService.js";

/**
 * Connects to Polymarket WebSocket
 */
export function connectToPolymarket(assetIds) {
  return new Promise((resolve, reject) => {
    const existingWs = getPolymarketWs();
    if (existingWs) {
      existingWs.close();
    }

    const ws = new WebSocket(`${POLYMARKET_WS_URL}/ws/market`);

    ws.on("open", () => {
      const subscriptionMessage = {
        assets_ids: assetIds,
        type: "market",
      };
      ws.send(JSON.stringify(subscriptionMessage));

      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("PING");
        } else {
          clearInterval(pingInterval);
        }
      }, 10000);

      setPolymarketWs(ws);
      resolve(ws);
    });

    ws.on("message", (message) => {
      const messageStr = message.toString();
      if (messageStr === "PONG") return;

      try {
        const data = JSON.parse(messageStr);
        if (data.event_type) {
          processOrderBookUpdate(data);
        }
      } catch (error) {
        // Not JSON, ignore
      }
    });

    ws.on("error", (error) => {
      reject(error);
    });

    ws.on("close", () => {
      setTimeout(() => {
        connectToPolymarket(getCurrentAssetIds()).catch(() => {});
      }, 5000);
    });
  });
}

/**
 * Updates market subscription when market changes (e.g., hour changes for Bitcoin)
 */
export async function updateMarketSubscription() {
  try {
    const marketData = await fetchCurrentAssetIds();
    const newAssetIds = marketData.assetIds;
    const newOutcomes = marketData.outcomes;
    const oldIds = JSON.stringify(getCurrentAssetIds());
    const newIds = JSON.stringify(newAssetIds);

    if (oldIds === newIds) return;

    setCurrentAssetIds(newAssetIds);
    setCurrentOutcomes(newOutcomes);
    setClobTokenIdsByOutcome(marketData.clobTokenIdsByOutcome || null);
    setCurrentMarketMetadata({
      title: marketData.title,
      image: marketData.image,
      slug: marketData.slug,
    });

    initializeMarketState(newOutcomes);

    const marketConfig = getActiveMarketConfig();
    const metadata = getCurrentMarketMetadata();
    const marketChangedPayload = {
      type: "market_changed",
      assetIds: newAssetIds,
      outcomes: newOutcomes,
      title: metadata.title,
      image: metadata.image,
      slug: metadata.slug,
      marketType: marketConfig.type,
      timestamp: Date.now(),
    };
    const clobByOutcome = getClobTokenIdsByOutcome();
    if (clobByOutcome) marketChangedPayload.clobTokenIdsByOutcome = clobByOutcome;
    broadcast(marketChangedPayload);

    await connectToPolymarket(newAssetIds);
    await loadInitialOrderbooks();
  } catch (error) {
    // Failed to update market subscription
  }
}

/**
 * Monitors time and updates market when configured interval changes
 */
export function startTimeMonitoring() {
  const marketConfig = getActiveMarketConfig();
  if (!marketConfig.dynamicSlug || !marketConfig.rotationInterval) {
    console.log("ℹ️  Market has static slug, skipping time monitoring");
    return;
  }

  if (marketConfig.rotationInterval === "hourly") {
    const { rawHour } = getETDateTime();
    setCurrentHour(rawHour);

    setInterval(async () => {
      const { rawHour: newHour } = getETDateTime();
      if (newHour !== getCurrentHour()) {
        setCurrentHour(newHour);
        await updateMarketSubscription();
      }
    }, 60000);
  }
}

/**
 * Ensures candles advance even if no WS updates arrive in a given second.
 */
export function startCandleTicker() {
  setInterval(() => {
    const outcomeKeys = Object.keys(getOrderBookState());
    outcomeKeys.forEach((outcomeKey) => {
      processPriceForCandles(outcomeKey);
    });
  }, CANDLE_TICK_INTERVAL_MS);
}
