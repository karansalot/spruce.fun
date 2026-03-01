import https from "https";
import {
  getActiveMarketConfig,
  generateSlug,
} from "../config/marketConfig.js";

/**
 * Fetches market data from Polymarket API
 */
export function fetchMarketData(slug) {
  return new Promise((resolve, reject) => {
    const url = `https://gamma-api.polymarket.com/events/slug/${slug}`;

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
            reject(new Error(`Failed to parse JSON: ${error.message}`));
          }
        });
      })
      .on("error", (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });
  });
}

/**
 * Extracts clobTokenIds and outcomes from the API response
 * Handles both binary markets (single market) and multi-outcome markets (multiple markets)
 */
export function extractClobTokenIds(response) {
  if (!response || !response.markets || response.markets.length === 0) {
    return null;
  }

  const marketConfig = getActiveMarketConfig();

  if (marketConfig.type === "binary") {
    const market = response.markets[0];
    const clobTokenIds = market.clobTokenIds || null;
    let outcomes = market.outcomes || null;

    if (
      outcomes &&
      marketConfig.outcomeMapping &&
      Array.isArray(marketConfig.outcomeMapping)
    ) {
      if (outcomes.length === marketConfig.outcomeMapping.length) {
        outcomes = marketConfig.outcomeMapping;
      }
    }

    return { clobTokenIds, outcomes };
  }

  if (marketConfig.type === "multi") {
    const clobTokenIdsByOutcome = {};

    response.markets.forEach((market) => {
      const groupItemTitle = market.groupItemTitle || market.question;
      const clobTokenIds = market.clobTokenIds;
      const outcomes = market.outcomes;

      if (!clobTokenIds || !outcomes) return;

      if (
        marketConfig.outcomeMapping &&
        Array.isArray(marketConfig.outcomeMapping)
      ) {
        const isIncluded = marketConfig.outcomeMapping.some(
          (mapped) =>
            mapped.toLowerCase() === groupItemTitle.toLowerCase() ||
            groupItemTitle.toLowerCase().includes(mapped.toLowerCase())
        );
        if (!isIncluded) return;
      }

      let tokenIdArray = Array.isArray(clobTokenIds)
        ? clobTokenIds
        : JSON.parse(clobTokenIds);
      let outcomeArray = Array.isArray(outcomes)
        ? outcomes
        : JSON.parse(outcomes);

      const yesIndex = outcomeArray.findIndex((o) => o.toLowerCase() === "yes");
      const noIndex = outcomeArray.findIndex((o) => o.toLowerCase() === "no");
      const yesId = yesIndex >= 0 ? tokenIdArray[yesIndex] : null;
      const noId = noIndex >= 0 ? tokenIdArray[noIndex] : null;

      const mappingLabel =
        marketConfig.outcomeMapping &&
        Array.isArray(marketConfig.outcomeMapping)
          ? marketConfig.outcomeMapping.find(
              (m) =>
                m.toLowerCase() === groupItemTitle.toLowerCase() ||
                groupItemTitle.toLowerCase().includes(m.toLowerCase())
            )
          : groupItemTitle;
      const outcomeKey = (mappingLabel || groupItemTitle)
        .toLowerCase()
        .replace(/\s+/g, "_");
      if (outcomeKey && (yesId || noId)) {
        clobTokenIdsByOutcome[outcomeKey] = [yesId || "", noId || ""];
      }
    });

    const tokenIds = [];
    const outcomeNames = [];
    const teamOrder =
      marketConfig.outcomeMapping && Array.isArray(marketConfig.outcomeMapping)
        ? marketConfig.outcomeMapping.map((m) =>
            m.toLowerCase().replace(/\s+/g, "_")
          )
        : Object.keys(clobTokenIdsByOutcome);
    const labelByKey = {};
    if (marketConfig.outcomeMapping) {
      marketConfig.outcomeMapping.forEach((m) => {
        labelByKey[m.toLowerCase().replace(/\s+/g, "_")] = m;
      });
    }
    for (const key of teamOrder) {
      const [yesId, noId] = clobTokenIdsByOutcome[key] || [];
      const label = labelByKey[key] || key.replace(/_/g, " ");
      if (yesId) {
        tokenIds.push(yesId);
        outcomeNames.push(`${label} Yes`);
      }
      if (noId) {
        tokenIds.push(noId);
        outcomeNames.push(`${label} No`);
      }
    }

    return {
      clobTokenIds: JSON.stringify(tokenIds),
      outcomes: JSON.stringify(outcomeNames),
      clobTokenIdsByOutcome,
    };
  }

  return null;
}

/**
 * Fetches current market asset IDs for the active market
 */
export async function fetchCurrentAssetIds() {
  const slug = generateSlug();
  const response = await fetchMarketData(slug);
  const tokenData = extractClobTokenIds(response);

  if (tokenData && tokenData.clobTokenIds && tokenData.outcomes) {
    let tokenIds = tokenData.clobTokenIds;
    let outcomes = tokenData.outcomes;

    if (typeof tokenIds === "string") {
      tokenIds = JSON.parse(tokenIds);
    }
    if (typeof outcomes === "string") {
      outcomes = JSON.parse(outcomes);
    }

    if (!Array.isArray(tokenIds) || !Array.isArray(outcomes)) {
      throw new Error(
        `Invalid data format: tokenIds and outcomes must be arrays`
      );
    }

    if (tokenIds.length !== outcomes.length) {
      throw new Error(
        `Mismatch: ${tokenIds.length} tokens but ${outcomes.length} outcomes`
      );
    }

    console.log(
      `✅ Fetched ${tokenIds.length} asset IDs for ${outcomes.length} outcomes`
    );
    outcomes.forEach((outcome, i) => {
      console.log(`   ${outcome}: ${tokenIds[i]}`);
    });
    if (tokenData.clobTokenIdsByOutcome) {
      console.log(
        `   Superbowl CLOB token IDs by team:`,
        tokenData.clobTokenIdsByOutcome
      );
    }
    console.log(`📝 Market Title: ${response.title}`);

    const result = {
      assetIds: tokenIds,
      outcomes: outcomes,
      title: response.title,
      image: response.image,
      slug: response.slug || slug,
    };
    if (tokenData.clobTokenIdsByOutcome) {
      result.clobTokenIdsByOutcome = tokenData.clobTokenIdsByOutcome;
    }
    return result;
  }

  throw new Error("clobTokenIds or outcomes not found in response");
}
