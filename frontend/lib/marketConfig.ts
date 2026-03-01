/**
 * Single source of truth for markets. Add a new market by adding an entry here;
 * the API, market page, and backend switch all use this.
 */

export type MarketCategory = 'Sports' | 'Crypto' | 'Politics' | 'Other';

export type MarketConfig = {
  /** Backend market id (must match backend config MARKET_CONFIGS[].id) */
  backendMarketId: string;
  type: 'binary' | 'multi';
  category: MarketCategory;
  /** Exact Polymarket event slug (for static markets) */
  slug?: string;
  /** Prefix for dynamic slugs (e.g. bitcoin-up-or-down). Used to match and to build slug when slugGenerator is set. */
  slugPattern?: string;
  /** Build current slug for dynamic markets (e.g. hourly Bitcoin). Used by API to fetch; slugPattern used to match. */
  slugGenerator?: () => string;
  /** Multi only: partial match labels for Polymarket outcomes (e.g. ["Seattle", "New England"]). If omitted, all outcomes from API are used. */
  outcomeLabels?: string[];
  /** Multi only: optional image URL per outcome label (short name from outcomeLabels) */
  teamImages?: Record<string, string>;
  /** Optional CLOB symbol base (e.g. SUPERBOWL-2026). If omitted, derived from slug. */
  clobSymbolBase?: string;
};

const getETDateTime = () => {
  const etDate = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
  );
  return {
    month: etDate.toLocaleString('en-US', { month: 'long' }).toLowerCase(),
    day: etDate.getDate(),
    hour: etDate.getHours(),
  };
};

/**
 * All markets: add a new object here to support a new market.
 * - backendMarketId must match an id in backend/config/marketConfig.js (add there too).
 * - slug: exact Polymarket event slug, or slugPattern + slugGenerator for dynamic (e.g. hourly).
 * - type: 'binary' (Up/Down) or 'multi' (e.g. team Yes/No).
 * - outcomeLabels (multi): optional partial match labels for Polymarket; omit to use all outcomes.
 */
export const MARKET_CONFIGS: MarketConfig[] = [
  {
    backendMarketId: 'superbowl',
    type: 'multi',
    category: 'Sports',
    slug: 'super-bowl-champion-2026-731',
    outcomeLabels: ['Seattle', 'New England'],
    teamImages: {
      'Seattle': 'https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/sea.png&h=100&w=100',
      'New England': 'https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/ne.png&h=100&w=100',
    },
    clobSymbolBase: 'SUPERBOWL-2026',
  },
  {
    backendMarketId: 'bitcoin',
    type: 'binary',
    category: 'Crypto',
    slugPattern: 'bitcoin-up-or-down',
    slugGenerator: () => {
      const { month, day, hour } = getETDateTime();
      const ampm = hour >= 12 ? 'pm' : 'am';
      const hour12 = hour % 12 === 0 ? 12 : hour % 12;
      return `bitcoin-up-or-down-${month}-${day}-${hour12}${ampm}-et`;
    },
  },
  {
    backendMarketId: 'trump-fed-chair',
    type: 'multi',
    category: 'Politics',
    slug: 'who-will-trump-nominate-as-fed-chair',
    outcomeLabels: ["Kevin Warsh", "Kevin Hassett", "Christopher Waller", "Bill Pulte", "Judy Shelton", "David Malpass", "Howard Lutnick", "Arthur Laffer", "Larry Kudlow", "Jerome Powell", "Ron Paul", "Stephen Miran", "Scott Bessent", "James Bullard", "Marc Sumerlin", "David Zervos", "Rick Rieder", "Michelle Bowman", "Lorie K. Logan", "Philip Jefferson", "Janet Yellen", "Larry Lindsey", "Barron Trump", "Donald Trump", "nominate no one before 2027"],
    teamImages: {
      'Kevin Warsh': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-trump-nominate-kevin-warsh-as-the-next-fed-chair-Bc-vVyyVjhsS.jpg',
      'Kevin Hassett': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/kevin-hassett-6f7d954db3.png',
      'Christopher Waller': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/Christopher-Waller-0309d1899b.png',
      'Bill Pulte': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/Bill-Pulte-48cd0b3059.png',
      'Judy Shelton': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/judy-shelton-15c5dd306b.png',
      'David Malpass': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/david-malpass-a3f473d929.png',
      'Howard Lutnick': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/lutnick-c3d121236f.png',
      'Arthur Laffer': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/art-laffer-5419819f7c.png',
      'Larry Kudlow': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-trump-nominate-larry-kudlow-as-the-next-fed-chair-22iGjsYeI9BJ.jpg',
      'Jerome Powell': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/j-pow-532e1b348a.png',
      'Ron Paul': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-trump-nominate-ron-paul-as-the-next-fed-chair-_SXVyGJVPQ8K.jpg',
      'Stephen Miran': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-trump-nominate-stephen-miran-as-the-next-fed-chair-68UrB553SZLn.jpg',
      'Scott Bessent': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-trump-nominate-scott-bessent-as-the-next-fed-chair-icCnjC88ur87.jpg',
      'James Bullard': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/james-bullard-a2d5d259c5.png',
      'Marc Sumerlin': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/summerlin-134ea15a06.png',
      'David Zervos': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/zervos-8866bee48a.png',
      'Rick Rieder': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/rick-rieder-5e7df1486e.png',
      'Michelle Bowman': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/m-bowman-eb5550d48f.png',
      'Lorie K. Logan': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-trump-nominate-lorie-k-logan-as-the-next-fed-chair-zkJRO5vuIa43.jpg',
      'Philip Jefferson': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/philip-jefferson-4c7a013133.png',
      'Janet Yellen': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-trump-nominate-individual-j-as-the-next-fed-chair-bTDwG7CiX9Fm.jpg',
      'Larry Lindsey': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/Larry-Lindsey-ebfe6bf2a3.png',
      'Barron Trump': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/barron-trump-025476f7a8.png',
      'Donald Trump': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/djt-9c6cdcdd25.png',
      "Nominate no one before 2027": "https://polymarket-upload.s3.us-east-2.amazonaws.com/who-will-trump-nominate-as-fed-chair-9p19ttRwsbKL.png"
    },
  },
  {
    backendMarketId: 'Domestic-presidential-nomination',
    type: 'multi',
    category: 'Politics',
    slug: 'democratic-presidential-nominee-2028',
    outcomeLabels: [
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
    teamImages: {
      "Stephen A. Smith": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-stephen-smith-win-the-2028-us-presidential-election-TLNFUsNkT8yf.png",
      "Gretchen Whitmer": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-gretchen-whitmer-win-the-2028-us-presidential-election-l1zZ4pOvvoCN.png",
      "Oprah Winfrey": "https://polymarket-upload.s3.us-east-2.amazonaws.com/oprah+winfrey.png",
      "Andy Beshear": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-andy-beshear-win-the-2028-us-presidential-election-gHwMpj0k-Xon.png",
      "Pete Buttigieg": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-pete-buttigieg-win-the-2028-us-presidential-election-jPrwim0rDJDu.png",
      "Jon Ossoff": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Jon_Ossoff.png",
      "Gina Raimondo": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-gina-raimondo-win-the-2028-democratic-presidential-nomination-676-PWRJIxLqOlSS.png",
      "Raphael Warnock": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Raphael_Warnock.png",
      "Barack Obama": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Barack_Obama.png",
      "George Clooney": "https://polymarket-upload.s3.us-east-2.amazonaws.com/george+clooney.png",
      "Cory Booker": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-corey-booker-win-the-2028-democratic-presidential-nomination-125-Nw5wVdP1Y36Q.png",
      "Jon Stewart": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Jon_Stewart.png",
      "Tim Walz": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-tim-walz-win-the-2028-us-presidential-election-V8-ATYdzVQA9.png",
      "Bernie Sanders": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Bernie_Sanders.png",
      "Mark Kelly": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Mark_Kelly.png",
      "Liz Cheney": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Liz_Cheney.png",
      "Beto O'Rourke": "https://polymarket-upload.s3.us-east-2.amazonaws.com/beto+o'rourke.png",
      "Michelle Obama": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Michelle_Obama.png",
      "Zohran Mamdani": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Zohran_Mamdani.png",
      "Andrew Yang": "https://polymarket-upload.s3.us-east-2.amazonaws.com/andrew+yang.png",
      "Alexandria Ocasio-Cortez": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-alexandria-ocasio-cortez-win-the-2028-us-presidential-election-eX2nG09sPJUu.png",
      "Rahm Emanuel": "https://polymarket-upload.s3.us-east-2.amazonaws.com/rahm.png",
      "John Fetterman": "https://polymarket-upload.s3.us-east-2.amazonaws.com/John_Fetterman.png",
      "Kim Kardashian": "https://polymarket-upload.s3.us-east-2.amazonaws.com/kim.k.prez-f262548783.png",
      "Ruben Gallego": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Ruben_Gallego1.png",
      "Jared Polis": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Jared_Polis.png",
      "Mark Cuban": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Mark_Cuban.png",
      "Phil Murphy": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-phil-murphy-win-the-2028-democratic-presidential-nomination-611-TSpDwU2ocX34.png",
      "Wes Moore": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-wes-moore-win-the-2028-us-presidential-election-XPjvhtcLdoZV.png",
      "J.B. Pritzker": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-jb-pritzker-win-the-2028-us-presidential-election-iASug1bJ5kub.png",
      "LeBron James": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Lebron_James.png",
      "Hunter Biden": "https://polymarket-upload.s3.us-east-2.amazonaws.com/huter+biden.png",
      "Chelsea Clinton": "https://polymarket-upload.s3.us-east-2.amazonaws.com/chelsea+clinton.png",
      "Dwayne 'The Rock' Johnson": "https://polymarket-upload.s3.us-east-2.amazonaws.com/the+rock.png",
      "MrBeast": "https://polymarket-upload.s3.us-east-2.amazonaws.com/mrbeast+pres.png",
      "Chris Murphy": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Chris+Murphy.png",
      "Ro Khanna": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Ro_Khanna1.png",
      "Josh Shapiro": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-josh-shapiro-win-the-2028-us-presidential-election-h3nL-gpVkam1.png",
      "Roy Cooper": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Roy_Cooper.png",
      "Jasmine Crockett": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Jasmine+Crockett.png",
      "Kamala Harris": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-kamala-harris-win-the-2028-us-presidential-election-9XuXzOE7K1B1.png",
      "Hillary Clinton": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Hillary_Clinton.png",
      "Gavin Newsom": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-gavin-newsom-win-the-2028-us-presidential-election-x9lPL7_gXn--.png",
    },
  },
  {
    backendMarketId: 'presidential-election-winner-2028',
    type: 'multi',
    category: 'Politics',
    slug: 'presidential-election-winner-2028',
    outcomeLabels: [
      'JD Vance', 'Elon Musk', 'Gavin Newsom', 'Pete Buttigieg', 'Tim Walz', 'Josh Shapiro', 'Gretchen Whitmer', 'Marco Rubio', 'Alexandria Ocasio-Cortez', 'Wes Moore', 'Ron DeSantis', 'LeBron James', 'Andy Beshear', 'Glenn Youngkin', 'Tucker Carlson', 'Kamala Harris', 'Ivanka Trump', 'Stephen Smith', 'Tulsi Gabbard', 'JB Pritzker', 'Donald Trump', 'Jamie Dimon', "Donald Trump Jr.", 'Nikki Haley', 'Other', 'Vivek Ramaswamy', 'Greg Abbott', "Dwayne 'The Rock' Johnson", 'Kim Kardashian', 'Zohran Mamdani', 'Michelle Obama',
    ],
    teamImages: {
      "JD Vance": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-jd-vance-win-the-2028-us-presidential-election-P-zEgXjCWbdY.png",
      "Elon Musk": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Elon_Musk.png",
      "Gavin Newsom": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-gavin-newsom-win-the-2028-us-presidential-election-x9lPL7_gXn--.png",
      "Pete Buttigieg": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-pete-buttigieg-win-the-2028-us-presidential-election-jPrwim0rDJDu.png",
      "Tim Walz": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-tim-walz-win-the-2028-us-presidential-election-V8-ATYdzVQA9.png",
      "Josh Shapiro": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-josh-shapiro-win-the-2028-us-presidential-election-h3nL-gpVkam1.png",
      "Gretchen Whitmer": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-gretchen-whitmer-win-the-2028-us-presidential-election-l1zZ4pOvvoCN.png",
      "Marco Rubio": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-marco-rubio-win-the-2028-us-presidential-election-snF_pVUw4Ymx.png",
      "Alexandria Ocasio-Cortez": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-alexandria-ocasio-cortez-win-the-2028-us-presidential-election-eX2nG09sPJUu.png",
      "Wes Moore": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-wes-moore-win-the-2028-us-presidential-election-XPjvhtcLdoZV.png",
      "Ron DeSantis": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-ron-desantis-win-the-2028-us-presidential-election-qQ7i72caXvAW.png",
      "LeBron James": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Lebron_James.png",
      "Andy Beshear": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-andy-beshear-win-the-2028-us-presidential-election-gHwMpj0k-Xon.png",
      "Glenn Youngkin": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-glenn-youngkin-win-the-2028-us-presidential-election-XKzgYYMAs2zz.png",
      "Tucker Carlson": "https://polymarket-upload.s3.us-east-2.amazonaws.com/tucker.png",
      "Kamala Harris": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-kamala-harris-win-the-2028-us-presidential-election-9XuXzOE7K1B1.png",
      "Ivanka Trump": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-ivanka-trump-win-the-2028-us-presidential-election-3Yw42U8sW642.jpg",
      "Stephen Smith": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-stephen-smith-win-the-2028-us-presidential-election-TLNFUsNkT8yf.png",
      "Tulsi Gabbard": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-tulsi-gabbard-win-the-2028-us-presidential-election-0cQT8aWX-zIp.png",
      "JB Pritzker": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-jb-pritzker-win-the-2028-us-presidential-election-iASug1bJ5kub.png",
      "Donald Trump": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-donald-trump-win-the-2028-us-presidential-election-4gVusUQRi_GG.png",
      "Jamie Dimon": "https://polymarket-upload.s3.us-east-2.amazonaws.com/Jamie+Dimon.png",
      "Donald Trump Jr.": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-donald-trump-jr-win-the-2028-us-presidential-election-DyQTRbm48dfH.png",
      "Nikki Haley": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-nikki-haley-win-the-2028-us-presidential-election-pUzXkWs8--Wo.png",
      "Other": "https://polymarket-upload.s3.us-east-2.amazonaws.com/presidential-election-winner-2024-afdda358-219d-448a-abb5-ba4d14118d71.png",
      "Vivek Ramaswamy": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-vivek-ramaswamy-win-the-2028-us-presidential-election-kAh6CRJ05Brk.png",
      "Greg Abbott": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-greg-abbott-win-the-2028-us-presidential-election-iIx0UUNSJ5QB.png",
      "Dwayne 'The Rock' Johnson": "https://polymarket-upload.s3.us-east-2.amazonaws.com/the+rock.png",
      "Kim Kardashian": "https://polymarket-upload.s3.us-east-2.amazonaws.com/kim.k.prez-f262548783.png",
      "Zohran Mamdani": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-zohran-mamdani-win-the-2028-us-presidential-election-O9QJqrRLtw4m.jpg",
      "Michelle Obama": "https://polymarket-upload.s3.us-east-2.amazonaws.com/will-michelle-obama-win-the-2028-us-presidential-election-7kJdypvAtU5z.jpg",
    },
  },
  {
    backendMarketId: 'fifa-world-cup-2026',
    type: 'multi',
    category: 'Sports',
    slug: '2026-fifa-world-cup-winner-595',
    outcomeLabels: [
      'Spain', 'New Zealand', 'Switzerland', 'England', 'France', 'South Korea', 'Haiti', 'Brazil', 'Jordan', 'Curaçao', 'Argentina', 'Germany', 'Colombia', 'Iran', 'Portugal', 'Ghana', 'Netherlands', 'Algeria', 'Italy', 'USA', 'Canada', 'Uruguay', 'Mexico', 'Paraguay', 'Scotland', 'Peru', 'Japan', 'Norway', 'Other', 'Tunisia', 'Ecuador', 'Uzbekistan', 'Morocco', 'South Africa', 'Senegal', 'Ivory Coast', 'Cape Verde', 'Qatar', 'Belgium', 'Australia', 'Saudi Arabia', 'Austria', 'Croatia', 'Egypt',
    ],
    teamImages: {
      'Spain': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-spain-win-the-2026-fifa-world-cup-963-GGS_qu77mAwD.jpg',
      'New Zealand': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-new-zealand-win-the-2026-fifa-world-cup-635-UJN1ZGjuo_tW.jpg',
      'Switzerland': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-switzerland-win-the-2026-fifa-world-cup-eCM9jYbpBu5K.jpg',
      'England': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-england-win-the-2026-fifa-world-cup-937-_1d1dBqIjAJF.png',
      'France': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-france-win-the-2026-fifa-world-cup-924-HpDpNpZGzhE6.png',
      'South Korea': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-south-korea-win-the-2026-fifa-world-cup-485--jX-CFS0s6Gi.jpg',
      'Haiti': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-haiti-win-the-2026-fifa-world-cup-kOKkHS61cdqs.jpg',
      'Brazil': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-brazil-win-the-2026-fifa-world-cup-183-mWG-xaHVZtUa.png',
      'Jordan': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-jordan-win-the-2026-fifa-world-cup-233-uslP9a0JCdSX.jpg',
      'Curaçao': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-curaao-win-the-2026-fifa-world-cup-VirrH9wdeB8e.jpg',
      'Argentina': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-argentina-win-the-2026-fifa-world-cup-245-fNAFwGoMJCpr.png',
      'Germany': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-germany-win-the-2026-fifa-world-cup-467-bMMLcP0kbRWp.png',
      'Colombia': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-colombia-win-the-2026-fifa-world-cup-734-f-5lazhIT4eT.jpg',
      'Iran': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-iran-win-the-2026-fifa-world-cup-788-9rtqjpUm7TXr.jpg',
      'Portugal': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-portugal-win-the-2026-fifa-world-cup-912-hBSLTDz-fryP.jpg',
      'Ghana': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-ghana-win-the-2026-fifa-world-cup-EY4rHJYUIT0s.jpg',
      'Netherlands': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-netherlands-win-the-2026-fifa-world-cup-739-vMGKphh9oaFR.jpg',
      'Algeria': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-algeria-win-the-2026-fifa-world-cup-X8LG9aasOArb.jpg',
      'Italy': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-italy-win-the-2026-fifa-world-cup-813-nZzIQwZ4hlqW.jpg',
      'USA': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-usa-win-the-2026-fifa-world-cup-467-HSwwccrla5fz.jpg',
      'Canada': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-canada-win-the-2026-fifa-world-cup-755-AIJqQHcuzIgC.jpg',
      'Uruguay': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-uruguay-win-the-2026-fifa-world-cup-932-_dehTCk0jVI6.jpg',
      'Mexico': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-mexico-win-the-2026-fifa-world-cup-529-CmZbz0GIAvB8.jpg',
      'Paraguay': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-paraguay-win-the-2026-fifa-world-cup-967-teIMqgUzfpCe.jpg',
      'Scotland': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-scotland-win-the-2026-fifa-world-cup-lendNjUbWo4s.jpg',
      'Peru': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-peru-win-the-2026-fifa-world-cup-981-BmY9cK7b3vkl.jpg',
      'Japan': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-japan-win-the-2026-fifa-world-cup-112-8AQwfmoAsz2d.jpg',
      'Norway': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-norway-win-the-2026-fifa-world-cup-893-fuf9rF2E62eo.jpg',
      'Other': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/2026-fifa-world-cup-winner-ITPKPUTc8QkB.jpg',
      'Tunisia': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-tunisia-win-the-2026-fifa-world-cup-165-x5mCDpdPmnHo.jpg',
      'Ecuador': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-ecuador-win-the-2026-fifa-world-cup-986-uC9PrssrShwX.jpg',
      'Uzbekistan': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-uzbekistan-win-the-2026-fifa-world-cup-773-YUDww6rLHD3U.jpg',
      'Morocco': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-morocco-win-the-2026-fifa-world-cup-464-QpTtZyzkg1UV.jpg',
      'South Africa': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-south-africa-win-the-2026-fifa-world-cup-9KALZ7u_frRo.jpg',
      'Senegal': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-senegal-win-the-2026-fifa-world-cup-_aVr7pz_5zsU.jpg',
      'Ivory Coast': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-ivory-coast-win-the-2026-fifa-world-cup-wQubhzNJEmHd.jpg',
      'Cape Verde': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-cape-verde-win-the-2026-fifa-world-cup-3ZMQE_Hk7WJ4.jpg',
      'Qatar': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-qatar-win-the-2026-fifa-world-cup-lYLVDMNuB_rz.jpg',
      'Belgium': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-belgium-win-the-2026-fifa-world-cup-358-I6h99tED1CtG.jpg',
      'Australia': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-australia-win-the-2026-fifa-world-cup-816-h07AmxNAmBOe.jpg',
      'Saudi Arabia': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-saudi-arabia-win-the-2026-fifa-world-cup-pmq7lZCrmxcU.jpg',
      'Austria': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-austria-win-the-2026-fifa-world-cup-NmIHr71Ym1Ya.png',
      'Croatia': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-croatia-win-the-2026-fifa-world-cup-h7JSLyZ5K641.jpg',
      'Egypt': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-egypt-win-the-2026-fifa-world-cup-Ez66tQiTRXQz.jpg',
    },
  },
  {
    backendMarketId: 'epl-winner-2026',
    type: 'multi',
    category: 'Sports',
    slug: 'english-premier-league-winner',
    outcomeLabels: [
      'Brentford', 'Newcastle', 'Crystal Palace', 'Nottm Forest', 'Brighton', 'Liverpool', 'Arsenal', 'Man City', 'Burnley', 'Chelsea', 'Sunderland', 'Man United', 'Tottenham', 'Aston Villa', 'Bournemouth', 'Everton', 'West Ham', 'Fulham', 'Wolves', 'Leeds', 'Other',
    ],
    teamImages: {
      'Brentford': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-brentford-win-the-202526-english-premier-league-olE_AFmH1ZjA.jpg',
      'Newcastle': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-newcastle-win-the-202526-english-premier-league-JeCs3gqdP-Lu.jpg',
      'Crystal Palace': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-crystal-palace-win-the-202526-english-premier-league-YlUIPYKjALxQ.jpg',
      'Nottm Forest': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-nottm-forest-win-the-202526-english-premier-league-_turYJpopA-W.jpg',
      'Brighton': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-brighton-win-the-202526-english-premier-league-xS2LRwSQd45X.jpg',
      'Liverpool': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-liverpool-win-the-202526-english-premier-league-3YErziIJn_VR.jpg',
      'Arsenal': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-arsenal-win-the-202526-english-premier-league-j8lEI_4IMCza.jpg',
      'Man City': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-man-city-win-the-202526-english-premier-league-7Upcy7IUKBdh.jpg',
      'Burnley': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-burnley-win-the-202526-english-premier-league-dWXrhnk-9A2I.jpg',
      'Chelsea': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-chelsea-win-the-202526-english-premier-league-pZV3BcmAKk11.jpg',
      'Sunderland': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-sunderland-win-the-202526-english-premier-league-Xm4kYgK5uZFd.jpg',
      'Man United': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-man-united-win-the-202526-english-premier-league--l9zruvtPXRY.jpg',
      'Tottenham': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-tottenham-win-the-202526-english-premier-league-L-w_6ANCB25S.jpg',
      'Aston Villa': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-aston-villa-win-the-202526-english-premier-league-MMCK6ta3GaI1.jpg',
      'Bournemouth': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-bournemouth-win-the-202526-english-premier-league-N4kdqkOYFL7D.jpg',
      'Everton': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-everton-win-the-202526-english-premier-league-q6jZPHv7445G.jpg',
      'West Ham': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-west-ham-win-the-202526-english-premier-league-rGaE8eGvd4Wd.jpg',
      'Fulham': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-fulham-win-the-202526-english-premier-league-ojjlv3G4FY4d.jpg',
      'Wolves': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-wolves-win-the-202526-english-premier-league-go0zje2Lk_QF.jpg',
      'Leeds': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-leeds-win-the-202526-english-premier-league-tSaX7zrXzuyD.jpg',
      'Other': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/will-any-other-club-win-the-202526-english-premier-league-tyP52-GhyeyB.jpg',
    },
  },
  {
    backendMarketId: 'nba-champion-2026',
    type: 'multi',
    category: 'Sports',
    slug: '2026-nba-champion',
    outcomeLabels: [
      'Oklahoma City Thunder', 'Houston Rockets', 'New Orleans Pelicans', 'Toronto Raptors', 'Chicago Bulls', 'Cleveland Cavaliers', 'New York Knicks', 'Minnesota Timberwolves', 'Phoenix Suns', 'Boston Celtics', 'Indiana Pacers', 'Orlando Magic', 'Denver Nuggets', 'San Antonio Spurs', 'Milwaukee Bucks', 'Los Angeles Clippers', 'Golden State Warriors', 'Dallas Mavericks', 'Detroit Pistons', 'Memphis Grizzlies', 'Los Angeles Lakers', 'Portland Trail Blazers', 'Atlanta Hawks', 'Brooklyn Nets', 'Charlotte Hornets', 'Utah Jazz', 'Sacramento Kings', 'Miami Heat', 'Philadelphia 76ers', 'Washington Wizards',
    ],
    teamImages: {
      'Oklahoma City Thunder': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Houston Rockets': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'New Orleans Pelicans': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Toronto Raptors': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Chicago Bulls': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Cleveland Cavaliers': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'New York Knicks': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Minnesota Timberwolves': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Phoenix Suns': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Boston Celtics': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Indiana Pacers': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Orlando Magic': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Denver Nuggets': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'San Antonio Spurs': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Milwaukee Bucks': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Los Angeles Clippers': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Golden State Warriors': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Dallas Mavericks': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Detroit Pistons': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Memphis Grizzlies': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Los Angeles Lakers': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Portland Trail Blazers': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Atlanta Hawks': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Brooklyn Nets': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Charlotte Hornets': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Utah Jazz': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Sacramento Kings': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Miami Heat': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Philadelphia 76ers': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
      'Washington Wizards': 'https://polymarket-upload.s3.us-east-2.amazonaws.com/nba-finals-points-leader-7g2ZEZvMXxLb.jpg',
    },
  }
];

/** Resolve a URL slug to the market config that handles it. */
export function getConfigForSlug(slug: string): MarketConfig | undefined {
  for (const config of MARKET_CONFIGS) {
    if (config.slug !== undefined && config.slug === slug) return config;
    if (config.slugPattern && slug.startsWith(config.slugPattern)) return config;
  }
  return undefined;
}

/** Get the Polymarket slug to fetch for a config (static slug or from slugGenerator). */
export function getPolymarketSlugForConfig(config: MarketConfig): string {
  if (config.slug) return config.slug;
  if (config.slugGenerator) return config.slugGenerator();
  if (config.slugPattern) {
    // Fallback: build from pattern (e.g. bitcoin)
    if (config.slugPattern.startsWith('bitcoin-up-or-down')) {
      const { month, day, hour } = getETDateTime();
      const ampm = hour >= 12 ? 'pm' : 'am';
      const hour12 = hour % 12 === 0 ? 12 : hour % 12;
      return `bitcoin-up-or-down-${month}-${day}-${hour12}${ampm}-et`;
    }
  }
  return '';
}
