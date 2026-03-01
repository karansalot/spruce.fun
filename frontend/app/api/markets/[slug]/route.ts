import { NextResponse } from 'next/server';
import {
  MARKET_CONFIGS,
  getConfigForSlug,
  getPolymarketSlugForConfig,
} from '@/lib/marketConfig';

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const config = getConfigForSlug(slug);
  if (!config) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  const polymarketSlug = getPolymarketSlugForConfig(config);
  if (!polymarketSlug) {
    return NextResponse.json({ error: 'No Polymarket slug' }, { status: 404 });
  }

  try {
    const response = await fetch(`${POLYMARKET_EVENT_URL}${polymarketSlug}`, {
      next: { revalidate: 30 },
    });
    if (!response.ok) {
      return NextResponse.json({ error: 'Polymarket fetch failed' }, { status: 502 });
    }

    const event = await response.json();

    if (config.type === 'multi') {
      const labels = config.outcomeLabels ?? [];
      const outcomes =
        labels.length > 0
          ? labels.map((label) => {
              const market = event.markets?.find((item: any) =>
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
                noTokenId: clobTokenIds?.[1],
              };
            })
          : (event.markets ?? []).slice(0, 10).map((market: any) => {
              const prices = parseJsonArray(market?.outcomePrices) as string[] | null;
              const yesPrice = prices?.[0] ? parseFloat(prices[0]) : 0;
              const clobTokenIds = parseJsonArray(market?.clobTokenIds) as string[] | null;
              return {
                label: market?.groupItemTitle || market?.question || 'Outcome',
                percent: formatPercent(yesPrice),
                image: undefined,
                tokenId: clobTokenIds?.[0],
                noTokenId: clobTokenIds?.[1],
              };
            });

      return NextResponse.json({
        title: event.title || 'Market',
        slug: event.slug ?? slug,
        category: config.category,
        variant: 'multi',
        outcomes,
        volume: formatVolume(Number(event.volume)),
        icon: event.icon ?? null,
      });
    }

    // Binary market
    const market = event.markets?.[0];
    const labels = parseJsonArray(market?.outcomes) as string[] | null;
    const prices = parseJsonArray(market?.outcomePrices) as string[] | null;
    const clobTokenIds = parseJsonArray(market?.clobTokenIds) as string[] | null;

    return NextResponse.json({
      title: event.title ?? 'Market',
      slug: event.slug ?? slug,
      category: config.category,
      variant: 'binary',
      percent: prices?.[0] ? Math.round(formatPercent(parseFloat(prices[0]))) : 0,
      primaryLabel: labels?.[0] ?? 'Up',
      secondaryLabel: labels?.[1] ?? 'Down',
      tokenId: clobTokenIds?.[0],
      volume: formatVolume(Number(event.volume)),
      icon: event.icon ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch market data' }, { status: 500 });
  }
}
