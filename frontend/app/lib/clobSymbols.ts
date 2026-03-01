/**
 * Generate CLOB orderbook symbols from slug and optional outcome.
 * Uses market config when available for symbol base; otherwise derives from slug.
 */

import { getConfigForSlug } from '@/lib/marketConfig';

/** Derive a short abbreviation from an outcome key (e.g. seattle_yes -> SEA-YES, new_england_no -> NE-NO). */
function outcomeKeyToAbbr(outcomeKey: string): string {
  // Check if it's a Yes/No outcome
  const isYes = outcomeKey.endsWith('_yes');
  const isNo = outcomeKey.endsWith('_no');
  const yesNoSuffix = isYes ? '-YES' : isNo ? '-NO' : '';
  
  // Remove _yes/_no suffix for team abbreviation
  const base = outcomeKey.replace(/_yes$|_no$/, '').trim();
  if (!base) return outcomeKey.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 3) + yesNoSuffix;
  
  const parts = base.split('_').filter(Boolean);
  let teamAbbr;
  if (parts.length >= 2) {
    teamAbbr = parts
      .map((p) => p[0])
      .join('')
      .toUpperCase()
      .substring(0, 3);
  } else {
    teamAbbr = base.substring(0, 3).toUpperCase();
  }
  
  return teamAbbr + yesNoSuffix;
}

export function generateCLOBSymbol(
  slug: string,
  marketType: 'binary' | 'multi',
  outcome?: string
): string {
  const config = getConfigForSlug(slug);

  if (marketType === 'binary') {
    if (slug.startsWith('bitcoin-up-or-down')) {
      const parts = slug.split('-');
      const month = parts[4] || 'jan';
      const day = parts[5] || '1';
      const time = parts[6] || '12pm';
      return `BTC-HOURLY-${month.toUpperCase()}-${day}-${time.toUpperCase()}`;
    }
    return slug.toUpperCase().replace(/[^A-Z0-9]/g, '-');
  }

  // Multi: use config clobSymbolBase if set, else derive from slug
  const base = config?.clobSymbolBase ?? slug.toUpperCase().replace(/[^A-Z0-9]/g, '-');
  if (outcome) {
    const abbr = outcomeKeyToAbbr(outcome);
    return `${base}-${abbr}`;
  }
  return base;
}

export async function initializeCLOBOrderbook(symbol: string): Promise<boolean> {
  const API_URL =
    process.env.NEXT_PUBLIC_ORDERBOOK_API || 'https://perporderbook-production.up.railway.app';

  try {
    const listResponse = await fetch(`${API_URL}/orderbooks`);
    if (listResponse.ok) {
      const { orderbooks } = await listResponse.json();
      if (orderbooks.includes(symbol)) return true;
    }

    const response = await fetch(`${API_URL}/orderbooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    });

    if (response.ok || response.status === 409) return true;
    return false;
  } catch (error) {
    console.error(`❌ Error initializing orderbook ${symbol}:`, error);
    return false;
  }
}
