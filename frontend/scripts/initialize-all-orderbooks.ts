/**
 * Initialize all orderbooks on the platform.
 *
 * 1. On-chain (Solana): There is a single CLOB order book per program; it is already
 *    initialized (run from contracts/solana/clob: npm run initialize-orderbook).
 *
 * 2. Hosted API: This script registers every CLOB symbol used by the frontend
 *    (from MARKET_CONFIGS) with the hosted orderbook service (Railway).
 *
 * Usage from frontend: npm run initialize-all-orderbooks
 */

const API_URL =
  process.env.NEXT_PUBLIC_ORDERBOOK_API || 'https://perporderbook-production.up.railway.app';

import { MARKET_CONFIGS, getPolymarketSlugForConfig } from '../lib/marketConfig';

function outcomeLabelToKey(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  return `${base}_yes`;
}

function outcomeKeyToAbbr(outcomeKey: string): string {
  const isYes = outcomeKey.endsWith('_yes');
  const isNo = outcomeKey.endsWith('_no');
  const yesNoSuffix = isYes ? '-YES' : isNo ? '-NO' : '';
  const base = outcomeKey.replace(/_yes$|_no$/, '').trim();
  if (!base) return outcomeKey.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 3) + yesNoSuffix;
  const parts = base.split('_').filter(Boolean);
  const teamAbbr =
    parts.length >= 2
      ? parts
          .map((p) => p[0])
          .join('')
          .toUpperCase()
          .substring(0, 3)
      : base.substring(0, 3).toUpperCase();
  return teamAbbr + yesNoSuffix;
}

function generateSymbol(
  slug: string,
  marketType: 'binary' | 'multi',
  config: (typeof MARKET_CONFIGS)[0],
  outcomeKey?: string
): string {
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
  const base = config.clobSymbolBase ?? slug.toUpperCase().replace(/[^A-Z0-9]/g, '-');
  if (outcomeKey) {
    const abbr = outcomeKeyToAbbr(outcomeKey);
    return `${base}-${abbr}`;
  }
  return base;
}

async function ensureOrderbook(symbol: string): Promise<boolean> {
  try {
    const listRes = await fetch(`${API_URL}/orderbooks`);
    if (listRes.ok) {
      const data = await listRes.json();
      const orderbooks = data.orderbooks ?? data;
      if (Array.isArray(orderbooks) && orderbooks.includes(symbol)) return true;
    }
    const res = await fetch(`${API_URL}/orderbooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    });
    return res.ok || res.status === 409;
  } catch (e) {
    console.error(`  ❌ ${symbol}:`, e);
    return false;
  }
}

async function main() {
  const symbols = new Set<string>();

  for (const config of MARKET_CONFIGS) {
    const slug = getPolymarketSlugForConfig(config);
    if (!slug) continue;

    if (config.type === 'binary') {
      const sym = generateSymbol(slug, 'binary', config);
      symbols.add(sym);
    } else {
      symbols.add(generateSymbol(slug, 'multi', config));
      if (config.outcomeLabels) {
        for (const label of config.outcomeLabels) {
          const key = outcomeLabelToKey(label);
          const sym = generateSymbol(slug, 'multi', config, key);
          symbols.add(sym);
        }
      }
    }
  }

  symbols.add('FED-CHAIR');

  const list = [...symbols].sort();
  console.log(`Initializing ${list.length} orderbook(s) at ${API_URL}...`);

  let ok = 0;
  let fail = 0;
  for (const symbol of list) {
    const success = await ensureOrderbook(symbol);
    if (success) {
      ok++;
      console.log(`  ✅ ${symbol}`);
    } else {
      fail++;
    }
  }

  console.log(`Done: ${ok} ok, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
