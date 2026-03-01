'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  getConnection,
  fetchOrderBook,
  fetchUserActiveOrders,
  createProgram,
  cancelOrder,
  shortAddress,
  explorerAddressUrl,
  type OrderView,
  type TradeView,
} from '../../lib/clob';
import { CLOB_PROGRAM_ID, USDC_MINT_DEVNET } from '../../lib/constants';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

export default function CLOBOrdersAndTrades() {
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'orders' | 'trades'>('orders');
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [trades, setTrades] = useState<TradeView[]>([]);
  const [orderBookState, setOrderBookState] = useState<{ buyOrders: OrderView[]; sellOrders: OrderView[]; tradeHistory: TradeView[] } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    if (!CLOB_PROGRAM_ID) return;
    try {
      const connection = getConnection();
      const { buyOrders, sellOrders, tradeHistory, initialized } = await fetchOrderBook(connection);
      if (initialized) setOrderBookState({ buyOrders, sellOrders, tradeHistory });
    } catch {}
  }, []);

  const fetchOrders = useCallback(async () => {
    if (!connected || !publicKey || !orderBookState) return;
    const userOrders = fetchUserActiveOrders(orderBookState, publicKey.toBase58());
    setOrders(userOrders);
  }, [connected, publicKey?.toBase58(), orderBookState]);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 5000);
    return () => clearInterval(interval);
  }, [fetchState]);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    const load = async () => {
      if (activeTab === 'orders') {
        if (orderBookState) fetchOrders();
      } else {
        if (orderBookState) setTrades(orderBookState.tradeHistory);
      }
      if (mounted) setIsLoading(false);
    };
    setIsLoading(true);
    load();
    const interval = setInterval(load, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [open, activeTab, orderBookState, fetchOrders]);

  const handleCancel = async (orderId: bigint) => {
    if (!publicKey || !wallet) return;
    const connection = getConnection();
    const program = createProgram(connection, wallet);
    if (!program) return;
    const usdcMint = new PublicKey(USDC_MINT_DEVNET);
    const userUsdc = getAssociatedTokenAddressSync(usdcMint, publicKey);
    setCancelling(orderId.toString());
    try {
      await cancelOrder(program, userUsdc, orderId);
      await fetchOrders();
      await fetchState();
      window.dispatchEvent(new Event('clob-orderbook-refresh'));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to cancel');
    } finally {
      setCancelling(null);
    }
  };

  const cancelAll = async () => {
    if (!confirm(`Cancel all ${orders.length} orders? Each will require a wallet confirmation.`)) return;
    for (const o of orders) {
      await handleCancel(o.id);
    }
  };

  const formatPrice = (bp: bigint) => `${Number(bp) / 100}¢`;
  const formatTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString();

  if (!CLOB_PROGRAM_ID) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-[#1a1f28] hover:bg-gray-200 dark:hover:bg-[#252b36] border border-gray-200 dark:border-[#1f2430] rounded-lg transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <span>Orders & Trades</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} role="presentation">
          <div
            className="w-full max-w-md rounded-xl bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="orders-trades-title"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#1f2430] bg-gray-50 dark:bg-[#0f131a]">
              <h2 id="orders-trades-title" className="text-sm font-semibold text-gray-900 dark:text-white">
                Active Orders & Trades
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#1f2430] transition-colors" aria-label="Close">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex border-b border-gray-200 dark:border-[#1f2430]">
              <button
                onClick={() => setActiveTab('orders')}
                className={`flex-1 px-4 py-2.5 text-xs font-semibold transition-colors ${
                  activeTab === 'orders' ? 'text-gray-900 dark:text-white border-b-2 border-blue-500 bg-blue-500/5 dark:bg-blue-500/10' : 'text-gray-500 dark:text-[#8b94a3] hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                My Orders {orders.length > 0 && `(${orders.length})`}
              </button>
              <button
                onClick={() => setActiveTab('trades')}
                className={`flex-1 px-4 py-2.5 text-xs font-semibold transition-colors ${
                  activeTab === 'trades' ? 'text-gray-900 dark:text-white border-b-2 border-blue-500 bg-blue-500/5 dark:bg-blue-500/10' : 'text-gray-500 dark:text-[#8b94a3] hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                Recent Trades
              </button>
            </div>

            <div className="max-h-[320px] overflow-y-auto">
              {activeTab === 'orders' && !connected ? (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <p className="text-sm text-gray-500 dark:text-[#8b94a3] text-center">Connect your wallet to view your orders</p>
                </div>
              ) : isLoading ? (
                <div className="p-4 space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-14 rounded-lg bg-gray-100 dark:bg-[#1a1f28] animate-pulse" />
                  ))}
                </div>
              ) : activeTab === 'orders' ? (
                <div className="p-3">
                  {orders.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-400 dark:text-[#666]">No active orders</div>
                  ) : (
                    <>
                      {orders.length > 1 && (
                        <div className="flex justify-end mb-2">
                          <button type="button" onClick={cancelAll} className="text-[11px] font-medium text-red-400 hover:text-red-300">
                            Cancel all
                          </button>
                        </div>
                      )}
                      <ul className="space-y-2">
                        {orders.map((order) => (
                          <li key={order.id.toString()} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-gray-50 dark:bg-[#0f131a] border border-gray-100 dark:border-[#1f2430]">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-semibold shrink-0 ${order.isBuy ? 'text-green-500' : 'text-red-500'}`}>{order.isBuy ? 'Buy' : 'Sell'}</span>
                                <span className="text-xs text-gray-500 dark:text-[#8b94a3] truncate">#{order.id.toString()}</span>
                              </div>
                              <div className="mt-1 flex items-baseline gap-3 text-xs">
                                <span className="text-gray-900 dark:text-white font-medium">{formatPrice(order.price)}</span>
                                <span className="text-gray-500 dark:text-[#8b94a3]">{Number(order.remainingQty)} shares</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCancel(order.id)}
                              disabled={cancelling === order.id.toString()}
                              className="shrink-0 px-2.5 py-1.5 text-[11px] font-medium text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-50"
                            >
                              {cancelling === order.id.toString() ? '…' : 'Cancel'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              ) : (
                <div className="p-3">
                  {trades.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-400 dark:text-[#666]">No recent trades</div>
                  ) : (
                    <ul className="space-y-2">
                      {[...trades].reverse().slice(0, 20).map((trade, idx) => (
                        <li key={idx} className="p-3 rounded-lg bg-gray-50 dark:bg-[#0f131a] border border-gray-100 dark:border-[#1f2430]">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-medium text-gray-900 dark:text-white">{formatPrice(trade.price)}</span>
                            <span className="text-[11px] text-gray-500 dark:text-[#8b94a3]">{formatTime(trade.timestamp)}</span>
                          </div>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-gray-500 dark:text-[#8b94a3]">{Number(trade.quantity)} shares</span>
                            <span className="flex items-center gap-1">
                              <a href={explorerAddressUrl(trade.buyer)} target="_blank" rel="noopener noreferrer" className="text-green-500 hover:underline font-mono">
                                {shortAddress(trade.buyer)}
                              </a>
                              <span className="text-gray-400">↔</span>
                              <a href={explorerAddressUrl(trade.seller)} target="_blank" rel="noopener noreferrer" className="text-red-500 hover:underline font-mono">
                                {shortAddress(trade.seller)}
                              </a>
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
