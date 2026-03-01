import https from "https";

/**
 * Fetch initial orderbook from Polymarket REST API
 */
export function fetchInitialOrderbook(assetId) {
  return new Promise((resolve, reject) => {
    const url = `https://clob.polymarket.com/book?token_id=${assetId}`;

    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const jsonData = JSON.parse(data);
            resolve(jsonData);
          } catch (error) {
            resolve(null);
          }
        });
      })
      .on("error", () => {
        resolve(null);
      });
  });
}

/** CLOB prices-history intervals per https://docs.polymarket.com/developers/CLOB/clients/methods-public#getpriceshistory */
const PRICE_HISTORY_INTERVALS = ["1m", "1h", "6h", "1d", "1w", "max"];

/**
 * Normalize CLOB response to { history: Array<{ t, p }> }.
 * API may return { history: [...] } or a raw array.
 */
function normalizePriceHistoryResponse(json) {
  if (Array.isArray(json)) {
    return { history: json };
  }
  if (json && Array.isArray(json.history)) {
    return json;
  }
  return { history: [] };
}

/**
 * Fetch price history from Polymarket CLOB getPricesHistory/timeseries API.
 * @see https://docs.polymarket.com/developers/CLOB/clients/methods-public#getpriceshistory
 * @see https://docs.polymarket.com/developers/CLOB/timeseries
 * @param {string} assetId - CLOB token ID (market parameter)
 * @param {string} interval - One of: 1m, 1h, 6h, 1d, 1w, max
 * @param {{ startTs?: number, endTs?: number, fidelity?: number }} [opts] - Optional start/end timestamps (Unix s), fidelity in minutes
 * @returns {Promise<{ history: Array<{ t: number, p: number }> }>}
 */
/** Default fidelity (resolution in minutes) per interval so we get enough points for a proper chart. */
const FIDELITY_BY_INTERVAL = {
  max: 1440,   // 1 day → full history
  "1m": 60,    // 1 month → hourly
  "1w": 60,    // 1 week → hourly (~168 points)
  "1d": 60,    // 1 day → hourly (24 points)
  "6h": 30,    // 6 hours → every 30 min (12 points)
  "1h": 15,    // 1 hour → every 15 min (4 points)
};

export function fetchPricesHistoryByInterval(assetId, interval, opts = {}) {
  const safeInterval = PRICE_HISTORY_INTERVALS.includes(interval) ? interval : "max";
  const params = new URLSearchParams({
    market: assetId,
    interval: safeInterval,
  });
  if (opts.startTs != null) params.set("startTs", String(opts.startTs));
  if (opts.endTs != null) params.set("endTs", String(opts.endTs));
  if (opts.fidelity != null) {
    params.set("fidelity", String(opts.fidelity));
  } else if (FIDELITY_BY_INTERVAL[safeInterval] != null) {
    params.set("fidelity", String(FIDELITY_BY_INTERVAL[safeInterval]));
  }
  const url = `https://clob.polymarket.com/prices-history?${params.toString()}`;

  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(normalizePriceHistoryResponse(json));
          } catch (error) {
            reject(new Error(`Failed to parse history: ${error.message}`));
          }
        });
      })
      .on("error", (error) => {
        reject(new Error(`History request failed: ${error.message}`));
      });
  });
}
