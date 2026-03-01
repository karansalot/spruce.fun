/**
 * Polymarket API URLs. When NEXT_PUBLIC_API_URL is not set, we use the default
 * hosted backend (perpmarket-production). If that were unset we'd fall back to
 * Polymarket's public APIs.
 */

import { DEFAULT_API_URL } from './constants';

const BACKEND_API = DEFAULT_API_URL;
const POLYMARKET_GAMMA = 'https://gamma-api.polymarket.com';
const POLYMARKET_CLOB = 'https://clob.polymarket.com';

/** Base URL for Polymarket-style requests. Empty means use direct Polymarket APIs. */
export function getPolymarketApiBase(): string {
  return BACKEND_API;
}

/** Whether we're using the app backend (vs Polymarket directly). */
export function useBackendProxy(): boolean {
  return Boolean(BACKEND_API.trim());
}

/** URL for event by slug (Gamma API). */
export function getPolymarketEventUrl(slug: string): string {
  if (useBackendProxy()) {
    return `${BACKEND_API.replace(/\/$/, '')}/api/polymarket/events/${encodeURIComponent(slug)}`;
  }
  return `${POLYMARKET_GAMMA}/events/slug/${encodeURIComponent(slug)}`;
}

/** URL for prices-history (CLOB API). */
export function getPolymarketPricesHistoryUrl(
  market: string,
  interval: string,
  fidelity?: number
): string {
  if (useBackendProxy()) {
    const u = `${BACKEND_API.replace(/\/$/, '')}/api/polymarket/prices-history?market=${encodeURIComponent(market)}&interval=${encodeURIComponent(interval)}`;
    return fidelity != null ? `${u}&fidelity=${fidelity}` : u;
  }
  const u = `${POLYMARKET_CLOB}/prices-history?market=${encodeURIComponent(market)}&interval=${encodeURIComponent(interval)}`;
  return fidelity != null ? `${u}&fidelity=${fidelity}` : u;
}

/** URL for order book by token id (CLOB API). */
export function getPolymarketBookUrl(tokenId: string): string {
  if (useBackendProxy()) {
    return `${BACKEND_API.replace(/\/$/, '')}/api/polymarket/book?token_id=${encodeURIComponent(tokenId)}`;
  }
  return `${POLYMARKET_CLOB}/book?token_id=${encodeURIComponent(tokenId)}`;
}
