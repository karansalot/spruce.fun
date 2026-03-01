'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  getConnection,
  fetchOrderBook,
  createProgram,
  initializeOrderBook,
  shortAddress,
  explorerAddressUrl,
  explorerTxUrl,
  type OrderView,
} from '../../lib/clob';
import { CLOB_PROGRAM_ID, USDC_MINT_DEVNET } from '../../lib/constants';
import { PublicKey } from '@solana/web3.js';

interface AggLevel {
  price: number;
  quantity: number;
  total: number;
  traders: { address: string; qty: number }[];
}

export default function CLOBOrderBook() {
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
  const [bids, setBids] = useState<AggLevel[]>([]);
  const [asks, setAsks] = useState<AggLevel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('Never');
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [initTx, setInitTx] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);

  const aggregate = useCallback((orders: OrderView[], descending: boolean): AggLevel[] => {
    const map = new Map<number, { qty: number; traders: { address: string; qty: number }[] }>();
    for (const o of orders) {
      const p = Number(o.price);
      const q = Number(o.remainingQty);
      if (q <= 0) continue;
      const existing = map.get(p);
      if (existing) {
        existing.qty += q;
        existing.traders.push({ address: o.trader, qty: q });
      } else {
        map.set(p, { qty: q, traders: [{ address: o.trader, qty: q }] });
      }
    }
    const sorted = [...map.entries()].sort((a, b) => (descending ? b[0] - a[0] : a[0] - b[0]));
    let cumTotal = 0;
    return sorted.map(([price, { qty, traders }]) => {
      cumTotal += (price * qty) / 100;
      return { price, quantity: qty, total: cumTotal, traders };
    });
  }, []);

  const fetchData = useCallback(async () => {
    if (!CLOB_PROGRAM_ID) return;
    try {
      const connection = getConnection();
      const { buyOrders, sellOrders, initialized: init } = await fetchOrderBook(connection);
      setInitialized(!!init);
      setBids(aggregate(buyOrders, true));
      setAsks(aggregate(sellOrders, false));
      setLastUpdate(new Date().toLocaleTimeString());
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch orderbook');
    } finally {
      setIsLoading(false);
    }
  }, [aggregate]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    const handleRefresh = () => fetchData();
    window.addEventListener('clob-orderbook-refresh', handleRefresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('clob-orderbook-refresh', handleRefresh);
    };
  }, [fetchData]);

  const formatPrice = (bp: number) => {
    const cents = bp / 100;
    return cents % 1 === 0 ? `${cents}¢` : `${cents.toFixed(2)}¢`;
  };
  const formatTotal = (cents: number) => {
    const dollars = cents / 100;
    return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`;
  };
  const maxDepth = Math.max(...bids.map((b) => b.total), ...asks.map((a) => a.total), 1);

  if (!CLOB_PROGRAM_ID) {
    return (
      <div className="w-full min-w-0 h-[320px] bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-xl flex items-center justify-center">
        <p className="text-sm text-gray-500 dark:text-[#7d8795]">Set NEXT_PUBLIC_CLOB_PROGRAM_ID to enable on-chain orderbook</p>
      </div>
    );
  }

  if (!initialized) {
    const handleInitialize = async () => {
      if (!publicKey) {
        setError('Connect your wallet to initialize the order book.');
        return;
      }
      setInitializing(true);
      setError(null);
      try {
        const connection = getConnection();
        const program = createProgram(connection, wallet);
        if (!program) {
          setError('Wallet not ready. Try reconnecting.');
          setInitializing(false);
          return;
        }
        const tx = await initializeOrderBook(
          program,
          new PublicKey(USDC_MINT_DEVNET),
          'FED-CHAIR',
          publicKey
        );
        setInitTx(tx);
        await fetchData();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Initialization failed');
      } finally {
        setInitializing(false);
      }
    };

    const canInitialize = Boolean(publicKey);
    return (
      <div className="w-full min-w-0 h-[320px] bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-xl flex flex-col items-center justify-center gap-4 p-4">
        <p className="text-sm text-gray-500 dark:text-[#7d8795] text-center">
          Order book not initialized on-chain. Initialize with a USDC mint first.
        </p>
        <p className="text-xs text-gray-400 dark:text-[#666] text-center">
          Uses devnet USDC ({USDC_MINT_DEVNET.slice(0, 4)}…{USDC_MINT_DEVNET.slice(-4)}). You pay rent for the accounts.
        </p>
        {!canInitialize ? (
          <p className="text-xs text-amber-500 dark:text-amber-400">Connect your Solana wallet (top right) to enable the button.</p>
        ) : (
          <button
            type="button"
            onClick={handleInitialize}
            disabled={initializing}
            className="px-4 py-2 rounded-lg bg-[#2f6df6] hover:bg-[#2563eb] disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {initializing ? 'Initializing…' : 'Initialize order book'}
          </button>
        )}
        {initTx && (
          <a
            href={explorerTxUrl(initTx)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#2f6df6] hover:underline"
          >
            View transaction on Explorer →
          </a>
        )}
        {error && <p className="text-xs text-red-400 text-center">{error}</p>}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-full min-w-0 h-[320px] bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 dark:border-[#1f2430]">
          <div className="h-3 w-28 rounded bg-gray-200 dark:bg-[#1f2430] animate-pulse" />
        </div>
        <div className="flex-1 animate-pulse p-2 space-y-1">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="grid grid-cols-4 gap-2">
              <div className="h-3 bg-gray-200 dark:bg-[#1f2430] rounded ml-auto w-12" />
              <div className="h-3 bg-gray-200 dark:bg-[#1f2430] rounded ml-auto w-10" />
              <div className="h-3 bg-gray-200 dark:bg-[#1f2430] rounded ml-auto w-14" />
              <div className="h-3 bg-gray-200 dark:bg-[#1f2430] rounded ml-auto w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 h-[320px] bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-xl overflow-hidden flex flex-col">
      {error && (
        <div className="px-3 py-1 bg-red-500/10 border-b border-red-500/20 flex items-center justify-between">
          <span className="text-[10px] text-red-400">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-[10px]">✕</button>
        </div>
      )}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 dark:border-[#1f2430]">
        <div className="flex items-center gap-1.5">
          <h2 className="text-xs font-semibold text-gray-900 dark:text-white">On-Chain Order Book</h2>
          <span className="px-1 py-0.5 text-[9px] font-bold bg-emerald-500/20 text-emerald-400 rounded">SOLANA</span>
        </div>
        <span className="text-[10px] text-gray-500 dark:text-[#8b94a3]">{lastUpdate}</span>
      </div>
      <div className="grid grid-cols-4 gap-2 px-3 py-0.5 text-[9px] font-semibold text-gray-500 dark:text-[#7d8795] border-b border-gray-200 dark:border-[#1f2430] bg-white dark:bg-[#12161c] uppercase tracking-wider">
        <div className="text-right">Price</div>
        <div className="text-right">Size</div>
        <div className="text-right">Total</div>
        <div className="text-right">Trader</div>
      </div>
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0 bg-white dark:bg-[#12161c] flex flex-col-reverse">
          {asks.length === 0 ? (
            <div className="px-3 py-2 text-center text-gray-400 dark:text-[#666] text-[10px]">
              <div className="text-red-400 font-semibold mb-0.5">ASKS</div>
              No asks — Place sell orders
            </div>
          ) : (
            <>
              <div className="px-3 py-0.5 bg-gray-50 dark:bg-[#0f131a] border-b border-gray-200 dark:border-[#1f2430] sticky top-0 z-20">
                <div className="text-[10px] text-red-400 font-semibold">ASKS</div>
              </div>
              {asks.slice(0, 8).map((ask, idx) => {
                const depthPct = maxDepth > 0 ? (ask.total / maxDepth) * 100 : 0;
                const firstTrader = ask.traders[0];
                return (
                  <div key={`ask-${ask.price}-${idx}`} className="grid grid-cols-4 gap-2 px-3 py-[3px] hover:bg-gray-50 dark:hover:bg-[#151a22] transition-colors relative shrink-0">
                    <div className="absolute left-0 top-0 bottom-0 bg-red-500/10" style={{ width: `${depthPct}%` }} />
                    <div className="text-right text-red-400 text-[11px] font-medium relative z-10">{formatPrice(ask.price)}</div>
                    <div className="text-right text-gray-700 dark:text-[#d2d6de] text-[11px] relative z-10">{ask.quantity.toLocaleString()}</div>
                    <div className="text-right text-gray-500 dark:text-[#8b94a3] text-[11px] relative z-10">{formatTotal(ask.total)}</div>
                    <div className="text-right relative z-10">
                      {firstTrader && (
                        <a href={explorerAddressUrl(firstTrader.address)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-purple-400 hover:text-purple-300 font-mono" title={firstTrader.address}>
                          {shortAddress(firstTrader.address)}
                        </a>
                      )}
                      {ask.traders.length > 1 && <span className="text-[9px] text-gray-500 dark:text-[#666] ml-1">+{ask.traders.length - 1}</span>}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
        <div className="px-3 py-1 border-y border-gray-200 dark:border-[#1f2430] bg-gray-50 dark:bg-[#0f131a]">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-gray-500 dark:text-[#8b94a3]">
              Spread: <span className="text-gray-900 dark:text-white font-medium">{asks.length > 0 && bids.length > 0 ? formatPrice(asks[0].price - bids[0].price) : '—'}</span>
            </span>
            <span className="text-gray-500 dark:text-[#8b94a3]">
              Mid: <span className="text-gray-900 dark:text-white font-medium">{asks.length > 0 && bids.length > 0 ? formatPrice(Math.round((asks[0].price + bids[0].price) / 2)) : '—'}</span>
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 bg-white dark:bg-[#12161c]">
          {bids.length === 0 ? (
            <div className="px-3 py-2 text-center text-gray-400 dark:text-[#666] text-[10px]">
              <div className="text-green-400 font-semibold mb-0.5">BIDS</div>
              No bids — Place buy orders
            </div>
          ) : (
            <>
              <div className="px-3 py-0.5 bg-gray-50 dark:bg-[#0f131a] border-b border-gray-200 dark:border-[#1f2430] sticky top-0 z-20">
                <div className="text-[10px] text-green-400 font-semibold">BIDS</div>
              </div>
              {bids.slice(0, 8).map((bid, idx) => {
                const depthPct = maxDepth > 0 ? (bid.total / maxDepth) * 100 : 0;
                const firstTrader = bid.traders[0];
                return (
                  <div key={`bid-${bid.price}-${idx}`} className="grid grid-cols-4 gap-2 px-3 py-[3px] hover:bg-gray-50 dark:hover:bg-[#151a22] transition-colors relative">
                    <div className="absolute left-0 top-0 bottom-0 bg-green-500/10" style={{ width: `${depthPct}%` }} />
                    <div className="text-right text-green-400 text-[11px] font-medium relative z-10">{formatPrice(bid.price)}</div>
                    <div className="text-right text-gray-700 dark:text-[#d2d6de] text-[11px] relative z-10">{bid.quantity.toLocaleString()}</div>
                    <div className="text-right text-gray-500 dark:text-[#8b94a3] text-[11px] relative z-10">{formatTotal(bid.total)}</div>
                    <div className="text-right relative z-10">
                      {firstTrader && (
                        <a href={explorerAddressUrl(firstTrader.address)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-purple-400 hover:text-purple-300 font-mono" title={firstTrader.address}>
                          {shortAddress(firstTrader.address)}
                        </a>
                      )}
                      {bid.traders.length > 1 && <span className="text-[9px] text-gray-500 dark:text-[#666] ml-1">+{bid.traders.length - 1}</span>}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
