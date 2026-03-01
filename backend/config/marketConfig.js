import { getETDateTime } from "../services/datetimeService.js";

export const POLYMARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com";

/**
 * Market Configuration
 *
 * Define all markets that the server should handle.
 *
 * Market Types:
 * - "binary": Two outcomes (e.g., Up/Down, Yes/No)
 * - "multi": Multiple outcomes (e.g., team names, candidates)
 *
 * Configuration Options:
 * - id: Unique identifier for the market
 * - type: "binary" or "multi"
 * - dynamicSlug: If true, slug changes over time (e.g., hourly Bitcoin markets)
 * - slug: Static slug (only for dynamicSlug: false)
 * - slugGenerator: Function to generate dynamic slugs (only for dynamicSlug: true)
 * - timezone: Timezone for time-based markets (e.g., "America/New_York")
 * - rotationInterval: How often to check for new markets ("hourly", "daily", etc.)
 * - outcomeMapping: Optional array to specify outcome order (null = use all from API)
 *
 * To add a new market:
 * 1. Add a new config object to MARKET_CONFIGS array
 * 2. Set the id, type, and slug (or slugGenerator)
 * 3. Deploy and use POST /api/market/switch to switch to the new market
 */
export const MARKET_CONFIGS = [
  {
    id: "bitcoin",
    type: "binary",
    dynamicSlug: true,
    slugGenerator: () => {
      const { month, day, hour, ampm } = getETDateTime();
      return `bitcoin-up-or-down-${month}-${day}-${hour}${ampm}-et`;
    },
    timezone: "America/New_York",
    rotationInterval: "hourly",
    outcomeMapping: ["up", "down"],
  },
  {
    id: "superbowl",
    type: "multi",
    dynamicSlug: false,
    slug: "super-bowl-champion-2026-731",
    outcomeMapping: ["Seattle", "New England"], // Only Seattle vs New England
  },
  {
    id: "trump-fed-chair",
    type: "multi",
    dynamicSlug: false,
    slug: "who-will-trump-nominate-as-fed-chair",
    outcomeMapping: [
      "Kevin Warsh",
      "Kevin Hassett",
      "Christopher Waller",
      "Bill Pulte",
      "Judy Shelton",
      "David Malpass",
      "Howard Lutnick",
      "Arthur Laffer",
      "Larry Kudlow",
      "Jerome Powell",
      "Ron Paul",
      "Stephen Miran",
      "Scott Bessent",
      "James Bullard",
      "Marc Sumerlin",
      "David Zervos",
      "Rick Rieder",
      "Michelle Bowman",
      "Lorie K. Logan",
      "Philip Jefferson",
      "Janet Yellen",
      "Larry Lindsey",
      "Barron Trump",
      "Donald Trump",
      "nominate no one before 2027",
    ],
  },
  {
    id: "Domestic-presidential-nomination",
    type: "multi",
    dynamicSlug: false,
    slug: "democratic-presidential-nominee-2028",
    outcomeMapping: [
      "Stephen A. Smith",
      "Gretchen Whitmer",
      "Oprah Winfrey",
      "Andy Beshear",
      "Pete Buttigieg",
      "Jon Ossoff",
      "Gina Raimondo",
      "Raphael Warnock",
      "Barack Obama",
      "George Clooney",
      "Cory Booker",
      "Jon Stewart",
      "Tim Walz",
      "Bernie Sanders",
      "Mark Kelly",
      "Liz Cheney",
      "Beto O'Rourke",
      "Michelle Obama",
      "Zohran Mamdani",
      "Andrew Yang",
      "Alexandria Ocasio-Cortez",
      "Rahm Emanuel",
      "John Fetterman",
      "Kim Kardashian",
      "Ruben Gallego",
      "Jared Polis",
      "Mark Cuban",
      "Phil Murphy",
      "Wes Moore",
      "J.B. Pritzker",
      "LeBron James",
      "Hunter Biden",
      "Chelsea Clinton",
      "Dwayne 'The Rock' Johnson",
      "MrBeast",
      "Chris Murphy",
      "Ro Khanna",
      "Josh Shapiro",
      "Roy Cooper",
      "Jasmine Crockett",
      "Kamala Harris",
      "Hillary Clinton",
      "Gavin Newsom",
    ],
  },
  {
    id: "presidential-election-winner-2028",
    type: "multi",
    dynamicSlug: false,
    slug: "presidential-election-winner-2028",
    outcomeMapping: [
      "JD Vance",
      "Elon Musk",
      "Gavin Newsom",
      "Pete Buttigieg",
      "Tim Walz",
      "Josh Shapiro",
      "Gretchen Whitmer",
      "Marco Rubio",
      "Alexandria Ocasio-Cortez",
      "Wes Moore",
      "Ron DeSantis",
      "LeBron James",
      "Andy Beshear",
      "Glenn Youngkin",
      "Tucker Carlson",
      "Kamala Harris",
      "Ivanka Trump",
      "Stephen Smith",
      "Tulsi Gabbard",
      "JB Pritzker",
      "Donald Trump",
      "Jamie Dimon",
      "Donald Trump Jr.",
      "Nikki Haley",
      "Other",
      "Vivek Ramaswamy",
      "Greg Abbott",
      "Dwayne 'The Rock' Johnson",
      "Kim Kardashian",
      "Zohran Mamdani",
      "Michelle Obama",
    ],
  },
  {
    id: "fifa-world-cup-2026",
    type: "multi",
    dynamicSlug: false,
    slug: "2026-fifa-world-cup-winner-595",
    outcomeMapping: [
      "Spain",
      "New Zealand",
      "Switzerland",
      "England",
      "France",
      "South Korea",
      "Haiti",
      "Brazil",
      "Jordan",
      "Curaçao",
      "Argentina",
      "Germany",
      "Colombia",
      "Iran",
      "Portugal",
      "Ghana",
      "Netherlands",
      "Algeria",
      "Italy",
      "USA",
      "Canada",
      "Uruguay",
      "Mexico",
      "Paraguay",
      "Scotland",
      "Peru",
      "Japan",
      "Norway",
      "Other",
      "Tunisia",
      "Ecuador",
      "Uzbekistan",
      "Morocco",
      "South Africa",
      "Senegal",
      "Ivory Coast",
      "Cape Verde",
      "Qatar",
      "Belgium",
      "Australia",
      "Saudi Arabia",
      "Austria",
      "Croatia",
      "Egypt",
    ],
  },
  {
    id: "epl-winner-2026",
    type: "multi",
    dynamicSlug: false,
    slug: "english-premier-league-winner",
    outcomeMapping: [
      "Brentford",
      "Newcastle",
      "Crystal Palace",
      "Nottm Forest",
      "Brighton",
      "Liverpool",
      "Arsenal",
      "Man City",
      "Burnley",
      "Chelsea",
      "Sunderland",
      "Man United",
      "Tottenham",
      "Aston Villa",
      "Bournemouth",
      "Everton",
      "West Ham",
      "Fulham",
      "Wolves",
      "Leeds",
      "Other",
    ],
  },
  {
    id: "nba-champion-2026",
    type: "multi",
    dynamicSlug: false,
    slug: "2026-nba-champion",
    outcomeMapping: [
      "Oklahoma City Thunder",
      "Houston Rockets",
      "New Orleans Pelicans",
      "Toronto Raptors",
      "Chicago Bulls",
      "Cleveland Cavaliers",
      "New York Knicks",
      "Minnesota Timberwolves",
      "Phoenix Suns",
      "Boston Celtics",
      "Indiana Pacers",
      "Orlando Magic",
      "Denver Nuggets",
      "San Antonio Spurs",
      "Milwaukee Bucks",
      "Los Angeles Clippers",
      "Golden State Warriors",
      "Dallas Mavericks",
      "Detroit Pistons",
      "Memphis Grizzlies",
      "Los Angeles Lakers",
      "Portland Trail Blazers",
      "Atlanta Hawks",
      "Brooklyn Nets",
      "Charlotte Hornets",
      "Utah Jazz",
      "Sacramento Kings",
      "Miami Heat",
      "Philadelphia 76ers",
      "Washington Wizards",
    ],
  },
];

const DEFAULT_MARKET_ID = process.env.DEFAULT_MARKET || "bitcoin";
let activeMarketConfig =
  MARKET_CONFIGS.find((m) => m.id === DEFAULT_MARKET_ID) || MARKET_CONFIGS[0];

export function getActiveMarketConfig() {
  return activeMarketConfig;
}

export function setActiveMarketConfig(config) {
  activeMarketConfig = config;
}

/**
 * Generates the slug for the current active market
 */
export function generateSlug() {
  if (activeMarketConfig.dynamicSlug && activeMarketConfig.slugGenerator) {
    return activeMarketConfig.slugGenerator();
  }
  return activeMarketConfig.slug;
}

export const TIMEFRAMES = {
  "1s": 1 * 1000,
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
};

export const AGGREGATABLE_TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "1w"]);
export const CANDLE_TICK_INTERVAL_MS = 1000;
export const DEBUG_CANDLE_GAPS = process.env.DEBUG_CANDLE_GAPS === "true";
