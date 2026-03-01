/**
 * Fetches market ID from Polymarket API for Bitcoin Up or Down market
 * The slug is dynamically generated based on current ET timezone
 */

const https = require("https");

/**
 * Gets the current date and time in ET timezone
 * @returns {Object} Object with month, day, hour, and ampm
 */
function getETDateTime() {
  // Create a date formatter for ET timezone
  const etDate = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );

  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];

  const month = months[etDate.getMonth()];
  const day = etDate.getDate();
  let hour = etDate.getHours();
  const ampm = hour >= 12 ? "pm" : "am";

  // Convert to 12-hour format
  hour = hour % 12;
  if (hour === 0) hour = 12;

  return {
    month,
    day,
    hour,
    ampm,
  };
}

/**
 * Generates the slug for the Polymarket event
 * Format: bitcoin-up-or-down-{month}-{day}-{hour}{ampm}-et
 * @returns {string} The event slug
 */
function generateSlug() {
  const { month, day, hour, ampm } = getETDateTime();
  console.log(`Generating slug for ${month}-${day}-${hour}${ampm}-et`);
  return `bitcoin-up-or-down-${month}-${day}-${hour}${ampm}-et`;
}

/**
 * Fetches market data from Polymarket API
 * @param {string} slug - The event slug
 * @returns {Promise<Object>} The API response
 */
function fetchMarketData(slug) {
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
 * Extracts market ID from the API response
 * @param {Object} response - The API response object
 * @returns {string|null} The market ID or null if not found
 */
function extractMarketId(response) {
  if (response && response.markets && response.markets.length > 0) {
    return response.markets[0].id;
  }
  return null;
}

/**
 * Extracts clobTokenIds string from the API response
 * @param {Object} response - The API response object
 * @returns {string|null} The clobTokenIds string or null if not found
 */
function extractClobTokenIds(response) {
  if (response && response.markets && response.markets.length > 0) {
    return response.markets[0].clobTokenIds || null;
  }
  return null;
}

/**
 * Main function to fetch market ID and clobTokenIds
 * @returns {Promise<Object>} Object containing marketId and clobTokenIds
 */
async function getMarketId() {
  try {
    const slug = generateSlug();
    console.log(`Fetching market data for slug: ${slug}`);

    const response = await fetchMarketData(slug);
    const marketId = extractMarketId(response);
    const clobTokenIds = extractClobTokenIds(response);

    if (marketId) {
      console.log(`Market ID: ${marketId}`);
      if (clobTokenIds) {
        console.log(`ClobTokenIds: ${clobTokenIds}`);
      }
      return {
        marketId,
        clobTokenIds,
      };
    } else {
      throw new Error("Market ID not found in response");
    }
  } catch (error) {
    console.error("Error fetching market ID:", error.message);
    throw error;
  }
}

// Export functions for use in other modules
module.exports = {
  getMarketId,
  generateSlug,
  getETDateTime,
  fetchMarketData,
  extractMarketId,
  extractClobTokenIds,
};

// If run directly, execute the main function
if (require.main === module) {
  getMarketId()
    .then((result) => {
      console.log(`Success! Market ID: ${result.marketId}`);
      if (result.clobTokenIds) {
        console.log(`ClobTokenIds: ${result.clobTokenIds}`);
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error("Failed to fetch market ID:", error);
      process.exit(1);
    });
}
