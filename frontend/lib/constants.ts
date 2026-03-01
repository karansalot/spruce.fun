// Solana CLOB (devnet)
export const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com';
export const CLOB_PROGRAM_ID = process.env.NEXT_PUBLIC_CLOB_PROGRAM_ID || 'FoUdTt3bhy7JrKqFk9Uqg6vJVa4MFqRe4PTwRgxWQggB';
// Devnet USDC – used when initializing the order book
export const USDC_MINT_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const USDC_DECIMALS = 6;

// Solana Explorer
export const SOLANA_EXPLORER_URL = 'https://explorer.solana.com';
export const SOLANA_EXPLORER_DEVNET = `${SOLANA_EXPLORER_URL}?cluster=devnet`;

// Hosted backend (Polymarket proxy + market data)
export const DEFAULT_API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://perpmarket-production.up.railway.app';
export const DEFAULT_WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || 'wss://perpmarket-production.up.railway.app';
// Orderbook service WebSocket (separate backend)
export const ORDERBOOK_WS_URL =
  process.env.NEXT_PUBLIC_ORDERBOOK_WS_URL || 'wss://perporderbook-production.up.railway.app';
