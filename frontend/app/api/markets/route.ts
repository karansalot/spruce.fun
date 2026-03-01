import { NextResponse } from 'next/server';
import {
  MARKET_CONFIGS,
  getPolymarketSlugForConfig,
  type MarketCategory,
} from '@/lib/marketConfig';

type MultiOutcomeMarket = {
  variant: 'multi';
  outcomes: Array<{ label: string; percent: number; image?: string; tokenId?: string }>;
};

type BinaryMarket = {
  variant: 'binary';
  percent: number;
  primaryLabel: string;
  secondaryLabel: string;
  statusLabel?: string;
};

type MarketCardData = {
  title: string;
  slug: string;
  category: MarketCategory;
  volume: string;
  icon: string | null;
  subtitle?: string;
} & (MultiOutcomeMarket | BinaryMarket);

const POLYMARKET_EVENT_URL = 'https://gamma-api.polymarket.com/events/slug/';

const parseJsonArray = (value: unknown) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
};

const formatPercent = (value: number) => Math.max(0, Math.min(100, value * 100));

const formatVolume = (value: number) => {
  if (!Number.isFinite(value)) return '$0';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}b`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${Math.round(value)}`;
};

const formatDateSubtitle = (endDate?: string, tag?: string) => {
  if (!endDate) return tag;
  const date = new Date(endDate);
  if (Number.isNaN(date.getTime())) return tag;
  const formatted = date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  });
  return tag ? `${tag} • ${formatted}` : formatted;
};

const fetchEvent = async (slug: string) => {
  const response = await fetch(`${POLYMARKET_EVENT_URL}${slug}`, {
    next: { revalidate: 60 },
  });
  if (!response.ok) return null;
  return response.json();
};

/** Returns true if the event is resolved/ended and should be excluded from the dashboard. */
function isEventEnded(event: {
  closed?: boolean;
  endDate?: string | null;
}): boolean {
  if (event.closed === true) return true;
  if (!event.endDate) return false;
  const endDate = new Date(event.endDate);
  if (Number.isNaN(endDate.getTime())) return false;
  return endDate.getTime() < Date.now();
}

function buildMultiCard(
  event: any,
  config: (typeof MARKET_CONFIGS)[0]
): MarketCardData | null {
  if (!event || !Array.isArray(event.markets)) return null;

  const labels = config.outcomeLabels ?? [];
  const outcomes =
    labels.length > 0
      ? labels.map((label) => {
          const market = event.markets.find((item: any) =>
            item.groupItemTitle?.toLowerCase().includes(label.toLowerCase())
          );
          const prices = parseJsonArray(market?.outcomePrices) as string[] | null;
          const yesPrice = prices?.[0] ? parseFloat(prices[0]) : 0;
          const clobTokenIds = parseJsonArray(market?.clobTokenIds) as string[] | null;
          return {
            label,
            percent: formatPercent(yesPrice),
            image: config.teamImages?.[label],
            tokenId: clobTokenIds?.[0],
          };
        })
      : event.markets.slice(0, 10).map((market: any) => {
          const prices = parseJsonArray(market?.outcomePrices) as string[] | null;
          const yesPrice = prices?.[0] ? parseFloat(prices[0]) : 0;
          const clobTokenIds = parseJsonArray(market?.clobTokenIds) as string[] | null;
          return {
            label: market?.groupItemTitle || market?.question || 'Outcome',
            percent: formatPercent(yesPrice),
            image: undefined,
            tokenId: clobTokenIds?.[0],
          };
        });

  return {
    title: event.title || 'Market',
    slug: event.slug ?? config.slug ?? '',
    category: config.category,
    variant: 'multi',
    outcomes,
    volume: formatVolume(Number(event.volume)),
    icon: event.icon ?? null,
    subtitle: formatDateSubtitle(event.endDate),
  };
}

function buildBinaryCard(
  event: any,
  config: (typeof MARKET_CONFIGS)[0],
  resolvedSlug: string
): MarketCardData | null {
  if (!event || !Array.isArray(event.markets) || event.markets.length === 0)
    return null;

  const market = event.markets[0];
  const labels = parseJsonArray(market.outcomes) as string[] | null;
  const prices = parseJsonArray(market.outcomePrices) as string[] | null;
  const primaryLabel = labels?.[0] ?? 'Up';
  const secondaryLabel = labels?.[1] ?? 'Down';
  const percent = prices?.[0] ? formatPercent(parseFloat(prices[0])) : 0;

  return {
    title: event.title ?? 'Market',
    slug: event.slug ?? resolvedSlug,
    category: config.category,
    variant: 'binary',
    percent: Math.round(percent),
    primaryLabel,
    secondaryLabel,
    statusLabel: event.active ? 'Live' : undefined,
    volume: formatVolume(Number(event.volume)),
    icon: event.icon ?? null,
    subtitle: formatDateSubtitle(event.endDate),
  };
}

export async function GET() {
  const cards: MarketCardData[] = [];

  for (const config of MARKET_CONFIGS) {
    const polymarketSlug = getPolymarketSlugForConfig(config);
    if (!polymarketSlug) continue;

    const event = await fetchEvent(polymarketSlug);
    if (!event) continue;

    if (isEventEnded(event)) continue;

    if (config.type === 'multi') {
      const card = buildMultiCard(event, config);
      if (card) cards.push(card);
    } else {
      const card = buildBinaryCard(event, config, polymarketSlug);
      if (card) cards.push(card);
    }
  }

  return NextResponse.json({ markets: cards });
}
