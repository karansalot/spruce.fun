import { getActiveMarketConfig } from "../config/marketConfig.js";
import {
  setCurrentAssetIds,
  setCurrentOutcomes,
  setClobTokenIdsByOutcome,
  setCurrentMarketMetadata,
} from "./state.js";
import { fetchCurrentAssetIds } from "./marketDataService.js";
import { initializeMarketState } from "./orderbookService.js";
import {
  connectToPolymarket,
  startTimeMonitoring,
  startCandleTicker,
} from "./polymarketWsService.js";
import { loadInitialOrderbooks } from "./orderbookService.js";

/**
 * Initializes the server: fetch market, init state, connect to Polymarket, load orderbooks, start monitoring.
 */
export async function initialize() {
  try {
    const marketConfig = getActiveMarketConfig();

    if (marketConfig.timezone) {
      console.log(
        `📅 Current time (${
          marketConfig.timezone
        }): ${new Date().toLocaleString("en-US", {
          timeZone: marketConfig.timezone,
        })}`
      );
    }

    const marketData = await fetchCurrentAssetIds();
    setCurrentAssetIds(marketData.assetIds);
    setCurrentOutcomes(marketData.outcomes);
    setClobTokenIdsByOutcome(marketData.clobTokenIdsByOutcome || null);
    setCurrentMarketMetadata({
      title: marketData.title,
      image: marketData.image,
      slug: marketData.slug,
    });

    initializeMarketState(marketData.outcomes);
    await connectToPolymarket(marketData.assetIds);
    await loadInitialOrderbooks();
    startTimeMonitoring();
    startCandleTicker();
  } catch (error) {
    console.error("Failed to initialize server", error);
    process.exit(1);
  }
}
