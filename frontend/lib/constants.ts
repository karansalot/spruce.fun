// Solana CLOB (devnet)
export const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com';
export const CLOB_PROGRAM_ID = process.env.NEXT_PUBLIC_CLOB_PROGRAM_ID || '3gHH4MLVgTtbFGeuX3LCPFeSEEY6kuRPwmTKzsrAdP7k';
/** Margin pool pubkey for leveraged orders (required when using leverage > 1). Set after calling set_margin_pool on-chain. */
export const CLOB_MARGIN_POOL = process.env.NEXT_PUBLIC_CLOB_MARGIN_POOL || '';
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
