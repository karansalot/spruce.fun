'use client';

import { useEffect, useState, useRef } from 'react';
import { getPolymarketBookUrl } from '@/lib/polymarketApi';
import { DEFAULT_WS_URL } from '@/lib/constants';

interface Order {
  price: number;
  size: number;
  total?: number;
}

interface OrderBookData {
  bids: Order[];
  asks: Order[];
  lastPrice?: number;
  spread?: number;
}

const WS_URL = DEFAULT_WS_URL;

export default function OrderBookDisplay({
  activeAsset = 'up',
  onAssetChange,
  marketType = 'binary',
  tokenId
}: {
  activeAsset?: string | null;
  onAssetChange?: (asset: string) => void;
  marketType?: 'binary' | 'multi';
  tokenId?: string;
}) {
  // Use local state if no prop provided, but prefer prop
  const [internalActiveAsset, setInternalActiveAsset] = useState<'up' | 'down'>('up');
  const currentAsset = (activeAsset as 'up' | 'down') || internalActiveAsset;

  const handleAssetChange = (asset: 'up' | 'down') => {
    if (onAssetChange) {
      onAssetChange(asset);
    } else {
      setInternalActiveAsset(asset);
    }
  };

  const [orderBooks, setOrderBooks] = useState<Record<string, OrderBookData>>({});

  // Initialize default states for up/down to prevent crashes if they are accessed before data arrives
  useEffect(() => {
    setOrderBooks(prev => ({
      ...prev,
      'up': { bids: [], asks: [] },
      'down': { bids: [], asks: [] }
    }));
  }, []);

  const [volume, setVolume] = useState<number>(0);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('Never');
  const [isLoading, setIsLoading] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectingRef = useRef(false);

  // Process server message
  const processServerMessage = (message: any) => {
    if (message.type === 'connected') {
      return;
    }

    if (message.type === 'market_changed') {
      // Clear current data
      setOrderBooks({});
      setVolume(0);
      return;
    }

    if (message.type === 'orderbook_update') {
      const { bids, asks, timestamp } = message;
      const asset = message.asset || message.outcome;

      if (!asset) return;

      // Calculate totals
      let bidTotal = 0;
      const bidsWithTotal = bids.map((bid: Order) => {
        bidTotal += bid.size;
        return { ...bid, total: bidTotal };
      });

      let askTotal = 0;
      const asksWithTotal = asks.map((ask: Order) => {
        askTotal += ask.size;
        return { ...ask, total: askTotal };
      });

      // Calculate last price and spread
      const bestAsk = asksWithTotal[0]?.price;
      const bestBid = bidsWithTotal[0]?.price;
      const lastPrice = bestBid || bestAsk || 0;
      const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;

      const orderBookData: OrderBookData = {
        bids: bidsWithTotal,
        asks: asksWithTotal,
        lastPrice,
        spread
      };

      setOrderBooks(prev => ({
        ...prev,
        [asset]: orderBookData
      }));

      // Mark as loaded after first data arrives
      if (isLoading) {
        setIsLoading(false);
      }

      // Emit price update event for TradingPanel — use best ask (first ask) as the display price
      const panelPrice = bestAsk ?? bestBid ?? 0;
      const priceEvent = new CustomEvent('priceUpdate', {
        detail: {
          asset,
          price: panelPrice,
          bestBid: bestBid || 0,
          bestAsk: bestAsk || 0
        }
      });
      window.dispatchEvent(priceEvent);

      // Update volume for active asset
      if (asset === currentAsset) {
        const totalVolume = bids.reduce((sum: number, b: Order) => sum + b.size, 0) +
          asks.reduce((sum: number, a: Order) => sum + a.size, 0);
        setVolume(totalVolume);
      }
    }
  };

  // Connect to our backend WebSocket server
  const connectWebSocket = () => {
    if (!WS_URL || reconnectingRef.current) {
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    reconnectingRef.current = true;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionError(null);
        reconnectingRef.current = false;
      };

      ws.onmessage = (event) => {
        setLastUpdate(new Date().toLocaleTimeString());

        try {
          const data = JSON.parse(event.data);
          processServerMessage(data);
        } catch (error) {
          // Silently handle parse errors
        }
      };

      ws.onerror = (error) => {
        setIsConnected(false);
        setConnectionError(null);
        reconnectingRef.current = false;
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        reconnectingRef.current = false;

        // Reconnect after 3 seconds
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 3000);
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setIsConnected(false);
      setConnectionError(`Connection failed: ${errorMessage}`);
      reconnectingRef.current = false;

      // Try to reconnect after a delay
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket();
      }, 3000);
    }
  };

  // Connect on mount
  useEffect(() => {
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  // Fetch Polymarket orderbook (hosted API or backend proxy) when tokenId is provided
  useEffect(() => {
    if (!tokenId) return;

    let cancelled = false;

    const fetchBook = async () => {
      try {
        const res = await fetch(getPolymarketBookUrl(tokenId));
        if (!res.ok || cancelled) return;
        const data = await res.json();

        // Parse bids and asks from Polymarket CLOB response
        const parseBids = (data.bids ?? []).map((b: any) => ({
          price: parseFloat(b.price),
          size: parseFloat(b.size),
        })).sort((a: any, b: any) => b.price - a.price);

        const parseAsks = (data.asks ?? []).map((a: any) => ({
          price: parseFloat(a.price),
          size: parseFloat(a.size),
        })).sort((a: any, b: any) => a.price - b.price);

        // Calculate running totals
        let bidTotal = 0;
        const bidsWithTotal = parseBids.map((bid: any) => {
          bidTotal += bid.size;
          return { ...bid, total: bidTotal };
        });

        let askTotal = 0;
        const asksWithTotal = parseAsks.map((ask: any) => {
          askTotal += ask.size;
          return { ...ask, total: askTotal };
        });

        const bestBid = bidsWithTotal[0]?.price ?? 0;
        const bestAsk = asksWithTotal[0]?.price ?? 0;

        if (cancelled) return;

        setOrderBooks(prev => ({
          ...prev,
          [currentAsset]: {
            bids: bidsWithTotal,
            asks: asksWithTotal,
            lastPrice: bestBid || bestAsk || 0,
            spread: bestAsk && bestBid ? bestAsk - bestBid : 0,
          },
        }));

        // Emit price update so parent (buttons) show best ask
        window.dispatchEvent(new CustomEvent('priceUpdate', {
          detail: {
            asset: currentAsset,
            price: bestAsk || bestBid || 0,
            bestBid,
            bestAsk,
          },
        }));

        if (isLoading) setIsLoading(false);
      } catch {
        // Silently handle fetch errors
      }
    };

    // Clear old data for new token
    setOrderBooks(prev => ({
      ...prev,
      [currentAsset]: { bids: [], asks: [] },
    }));
    setIsLoading(true);

    fetchBook();
    const interval = setInterval(fetchBook, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tokenId, currentAsset]);

  // Update volume when active asset changes
  useEffect(() => {
    const currentData = orderBooks[currentAsset] || { bids: [], asks: [] };
    if (currentData.bids.length > 0 || currentData.asks.length > 0) {
      const totalVolume = currentData.bids.reduce((sum, b) => sum + b.size, 0) +
        currentData.asks.reduce((sum, a) => sum + a.size, 0);
      setVolume(totalVolume);
    }
  }, [currentAsset, orderBooks]);

  const currentData = orderBooks[currentAsset] || { bids: [], asks: [], lastPrice: 0, spread: 0 };

  const formatCents = (price: number) => {
    const cents = price * 100;
    return `${cents.toFixed(2)}¢`;
  };

  const formatTotal = (total: number) => {
    const rounded = total.toFixed(2);
    if (rounded.endsWith('.00')) {
      return `$${Math.floor(total)}`;
    }
    return `$${rounded}`;
  };

  const maxDepth = Math.max(
    ...currentData.bids.map(b => b.total || 0),
    ...currentData.asks.map(a => a.total || 0),
    1 // Ensure at least 1 to avoid division by zero and mirror CLOB behavior
  );

  return (
    <div className="w-full min-w-0 h-[400px] min-h-[260px] max-h-[min(400px,45vh)] bg-white dark:bg-[#12161c] overflow-hidden flex flex-col">
      {/* Connection Error Banner */}
      {connectionError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 flex items-center justify-between">
          <span className="text-xs text-red-400">{connectionError}</span>
          <button
            onClick={() => setConnectionError(null)}
            className="text-red-400 hover:text-red-300 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-[#1f2430]">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Order Book</h2>
          <button className="text-gray-400 dark:text-[#666] hover:text-gray-900 dark:hover:text-white transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1" />
              <text x="7" y="9.5" textAnchor="middle" fontSize="8" fill="currentColor">
                ?
              </text>
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-[#8b94a3]">${volume.toFixed(0)} Vol.</span>
          <span className="text-xs text-gray-500 dark:text-[#8b94a3]">{lastUpdate}</span>
        </div>
      </div>

      {/* Asset Tabs */}
      {marketType === 'binary' && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-[#1f2430]">
          <button
            onClick={() => handleAssetChange('up')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${currentAsset === 'up'
                ? 'bg-gray-100 dark:bg-[#1a1a1a] text-gray-900 dark:text-white'
                : 'text-gray-400 dark:text-[#666] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#141414]'
              }`}
          >
            Trade Up
          </button>
          <button
            onClick={() => handleAssetChange('down')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${currentAsset === 'down'
                ? 'bg-gray-100 dark:bg-[#1a1a1a] text-gray-900 dark:text-white'
                : 'text-gray-400 dark:text-[#666] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#141414]'
              }`}
          >
            Trade Down
          </button>
        </div>
      )}

      {/* Order Book Content */}
      <div className="flex flex-col flex-1 min-h-0">
        {/* Column Headers */}
        <div className="grid grid-cols-3 gap-2 px-3 py-1 text-xs text-gray-500 dark:text-[#7d8795] border-b border-gray-200 dark:border-[#1f2430] bg-white dark:bg-[#12161c]">
          <div className="text-right">PRICE</div>
          <div className="text-right">SHARES</div>
          <div className="text-right">TOTAL</div>
        </div>

        {/* Asks (Red) - Top Section */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-white dark:bg-[#12161c] flex flex-col-reverse">
          {isLoading ? (
            <div className="flex-1 overflow-hidden bg-white dark:bg-[#12161c] animate-pulse p-3 space-y-1">
              {[...Array(7)].map((_, i) => (
                <div key={i} className="grid grid-cols-3 gap-2">
                  <div className="h-4 bg-gray-200 dark:bg-[#1f2430] rounded ml-auto w-16" />
                  <div className="h-4 bg-gray-200 dark:bg-[#1f2430] rounded ml-auto w-12" />
                  <div className="h-4 bg-gray-200 dark:bg-[#1f2430] rounded ml-auto w-16" />
                </div>
              ))}
            </div>
          ) : currentData.asks.length === 0 ? (
            <div className="px-3 py-4 text-center text-gray-400 dark:text-[#666] text-xs">
              <div className="text-red-400 font-semibold mb-1">ASKS</div>
              No asks - Place sell orders
            </div>
          ) : (
            <>
              <div className="px-3 py-1 bg-gray-50 dark:bg-[#0f131a] border-b border-gray-200 dark:border-[#1f2430] sticky top-0 z-20">
                <div className="text-xs text-red-400 font-semibold">ASKS</div>
              </div>
              {currentData.asks.map((ask, idx) => {
                const depthPercent = maxDepth > 0 ? ((ask.total || 0) / maxDepth) * 100 : 0;
                const handleAskClick = () => {
                  const priceInCents = ask.price * 100;
                  const sharesBelow = ask.total ?? 0;
                  window.dispatchEvent(new CustomEvent('orderbookPriceClick', {
                    detail: { asset: currentAsset, price: priceInCents, shares: sharesBelow }
                  }));
                };
                return (
                  <div
                    key={`ask-${idx}`}
                    role="button"
                    tabIndex={0}
                    onClick={handleAskClick}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleAskClick(); } }}
                    className="grid grid-cols-3 gap-2 px-3 py-1 hover:bg-gray-50 dark:hover:bg-[#151a22] transition-colors relative shrink-0 cursor-pointer"
                  >
                    <div
                      className="absolute left-0 top-0 bottom-0 bg-red-500/10"
                      style={{ width: `${depthPercent}%` }}
                    />
                    <div className="text-right text-red-400 text-xs font-medium relative z-10">
                      {formatCents(ask.price)}
                    </div>
                    <div className="text-right text-gray-700 dark:text-[#d2d6de] text-xs relative z-10">
                      {ask.size.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </div>
                    <div className="text-right text-gray-500 dark:text-[#8b94a3] text-xs relative z-10">
                      {formatTotal((ask.total || 0) * ask.price)}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Market Summary - Middle Bar */}
        <div className="px-3 py-1.5 border-y border-gray-200 dark:border-[#1f2430] bg-gray-50 dark:bg-[#0f131a]">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500 dark:text-[#8b94a3]">
              Last:{' '}
              <span className="text-gray-900 dark:text-white font-medium">
                {formatCents(currentData.lastPrice || 0)}
              </span>
            </span>
            <span className="text-gray-500 dark:text-[#8b94a3]">
              Spread:{' '}
              <span className="text-gray-900 dark:text-white font-medium">
                {formatCents(currentData.spread || 0)}
              </span>
            </span>
          </div>
        </div>

        {/* Bids (Green) - Bottom Section */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-white dark:bg-[#12161c]">
          {isLoading ? (
            <div className="flex-1 overflow-hidden bg-white dark:bg-[#12161c] animate-pulse p-3 space-y-1">
              {[...Array(7)].map((_, i) => (
                <div key={i} className="grid grid-cols-3 gap-2">
                  <div className="h-4 bg-gray-200 dark:bg-[#1f2430] rounded ml-auto w-16" />
                  <div className="h-4 bg-gray-200 dark:bg-[#1f2430] rounded ml-auto w-12" />
                  <div className="h-4 bg-gray-200 dark:bg-[#1f2430] rounded ml-auto w-16" />
                </div>
              ))}
            </div>
          ) : currentData.bids.length === 0 ? (
            <div className="px-3 py-4 text-center text-gray-400 dark:text-[#666] text-xs">
              <div className="text-green-400 font-semibold mb-1">BIDS</div>
              No bids - Place buy orders
            </div>
          ) : (
            <>
              <div className="px-3 py-1 bg-gray-50 dark:bg-[#0f131a] border-b border-gray-200 dark:border-[#1f2430] sticky top-0 z-20">
                <div className="text-xs text-green-400 font-semibold">BIDS</div>
              </div>
              {currentData.bids.map((bid, idx) => {
                const depthPercent = maxDepth > 0 ? ((bid.total || 0) / maxDepth) * 100 : 0;
                const handleBidClick = () => {
                  const priceInCents = bid.price * 100;
                  window.dispatchEvent(new CustomEvent('orderbookPriceClick', {
                    detail: { asset: currentAsset, price: priceInCents, shares: 0 }
                  }));
                };
                return (
                  <div
                    key={`bid-${idx}`}
                    role="button"
                    tabIndex={0}
                    onClick={handleBidClick}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleBidClick(); } }}
                    className="grid grid-cols-3 gap-2 px-3 py-1 hover:bg-gray-50 dark:hover:bg-[#151a22] transition-colors relative cursor-pointer"
                  >
                    <div
                      className="absolute left-0 top-0 bottom-0 bg-green-500/10"
                      style={{ width: `${depthPercent}%` }}
                    />
                    <div className="text-right text-green-400 text-xs font-medium relative z-10">
                      {formatCents(bid.price)}
                    </div>
                    <div className="text-right text-gray-700 dark:text-[#d2d6de] text-xs relative z-10">
                      {bid.size.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </div>
                    <div className="text-right text-gray-500 dark:text-[#8b94a3] text-xs relative z-10">
                      {formatTotal((bid.total || 0) * bid.price)}
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
