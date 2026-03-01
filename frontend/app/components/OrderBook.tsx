'use client';

import { useEffect, useState, useRef } from 'react';

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

import { DEFAULT_WS_URL } from '@/lib/constants';

const WS_URL = DEFAULT_WS_URL;

export default function OrderBook() {
  const [activeAsset, setActiveAsset] = useState<'up' | 'down'>('up');
  const [upAssetData, setUpAssetData] = useState<OrderBookData>({ bids: [], asks: [] });
  const [downAssetData, setDownAssetData] = useState<OrderBookData>({ bids: [], asks: [] });
  const [volume, setVolume] = useState<number>(0);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('Never');

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
      setUpAssetData({ bids: [], asks: [] });
      setDownAssetData({ bids: [], asks: [] });
      setVolume(0);
      return;
    }

    if (message.type === 'orderbook_update') {
      const { asset, bids, asks, timestamp } = message;

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

      if (asset === 'up') {
        setUpAssetData(orderBookData);
        // Emit price update event for TradingPanel
        const priceEvent = new CustomEvent('priceUpdate', {
          detail: { asset: 'up', price: lastPrice }
        });
        window.dispatchEvent(priceEvent);
      } else if (asset === 'down') {
        setDownAssetData(orderBookData);
        // Emit price update event for TradingPanel
        const priceEvent = new CustomEvent('priceUpdate', {
          detail: { asset: 'down', price: lastPrice }
        });
        window.dispatchEvent(priceEvent);
      }

      // Update volume for active asset
      if (asset === activeAsset) {
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
        setConnectionError('Failed to connect to server. Is the backend running on port 8080?');
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

  // Update volume when active asset changes
  useEffect(() => {
    const currentData = activeAsset === 'up' ? upAssetData : downAssetData;
    if (currentData.bids.length > 0 || currentData.asks.length > 0) {
      const totalVolume = currentData.bids.reduce((sum, b) => sum + b.size, 0) +
        currentData.asks.reduce((sum, a) => sum + a.size, 0);
      setVolume(totalVolume);
    }
  }, [activeAsset, upAssetData, downAssetData]);

  const currentData = activeAsset === 'up' ? upAssetData : downAssetData;

  const formatCents = (price: number) => {
    const cents = price * 100;
    const rounded = cents.toFixed(2);
    if (rounded.endsWith('.00')) {
      return `${Math.floor(cents)}¢`;
    }
    return `${rounded}¢`;
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
    ...currentData.asks.map(a => a.total || 0)
  );

  return (
    <div className="w-[380px] h-[380px] bg-[#1b1b1b] border border-[#333333] rounded-lg overflow-hidden shadow-2xl flex flex-col">
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#333333] flex-shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Order Book</h2>
          <button className="text-gray-400 dark:text-[#666] hover:text-gray-900 dark:hover:text-white transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1" />
              <text x="7" y="9.5" textAnchor="middle" fontSize="8" fill="currentColor">?</text>
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 dark:text-[#999]">${volume.toFixed(0)} Vol.</span>
          <span className="text-xs text-gray-400 dark:text-[#666]">{lastUpdate}</span>
        </div>
      </div>

      {/* Asset Tabs */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#333333] flex-shrink-0">
        <button
          onClick={() => setActiveAsset('up')}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${activeAsset === 'up'
            ? 'bg-gray-100 dark:bg-[#1a1a1a] text-gray-900 dark:text-white'
            : 'text-gray-400 dark:text-[#666] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#141414]'
            }`}
        >
          Trade Up
        </button>
        <button
          onClick={() => setActiveAsset('down')}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${activeAsset === 'down'
            ? 'bg-gray-100 dark:bg-[#1a1a1a] text-gray-900 dark:text-white'
            : 'text-gray-400 dark:text-[#666] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#141414]'
            }`}
        >
          Trade Down
        </button>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 gap-2 px-3 py-1.5 text-xs text-gray-400 dark:text-[#666] border-b border-gray-200 dark:border-[#333333] bg-white dark:bg-[#1b1b1b] flex-shrink-0">
        <div className="text-right">PRICE</div>
        <div className="text-right">SHARES</div>
        <div className="text-right">TOTAL</div>
      </div>

      {/* Asks (Red) - Top Section */}
      <div className="flex-1 overflow-y-auto min-h-0 bg-[#1b1b1b] flex flex-col-reverse">
        {currentData.asks.length === 0 ? (
          <div className="px-3 py-4 text-center text-gray-400 dark:text-[#666] text-xs">No asks</div>
        ) : (
          currentData.asks.map((ask, idx) => {
            const depthPercent = maxDepth > 0 ? ((ask.total || 0) / maxDepth) * 100 : 0;
            return (
              <div
                key={`ask-${idx}`}
                className="grid grid-cols-3 gap-2 px-3 py-1 hover:bg-[#141414] transition-colors relative shrink-0"
              >
                <div
                  className="absolute right-0 top-0 bottom-0 bg-red-500/10"
                  style={{ width: `${depthPercent}%` }}
                />
                <div className="text-right text-red-400 text-xs font-medium relative z-10">
                  {formatCents(ask.price)}
                </div>
                <div className="text-right text-gray-700 dark:text-[#ccc] text-xs relative z-10">
                  {ask.size.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-right text-gray-400 dark:text-[#999] text-xs relative z-10">
                  {formatTotal((ask.total || 0) * ask.price)}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Market Summary - Middle Bar */}
      <div className="px-4 py-2 border-y border-[#333333] bg-[#141414] flex-shrink-0">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400 dark:text-[#999]">
            Last: <span className="text-gray-900 dark:text-white font-medium">{formatCents(currentData.lastPrice || 0)}</span>
          </span>
          <span className="text-gray-400 dark:text-[#999]">
            Spread: <span className="text-gray-900 dark:text-white font-medium">{formatCents(currentData.spread || 0)}</span>
          </span>
        </div>
      </div>

      {/* Bids (Green) - Bottom Section */}
      <div className="flex-1 overflow-y-auto min-h-0 bg-[#1b1b1b]">
        {currentData.bids.length === 0 ? (
          <div className="px-3 py-4 text-center text-gray-400 dark:text-[#666] text-xs">No bids</div>
        ) : (
          currentData.bids.map((bid, idx) => {
            const depthPercent = maxDepth > 0 ? ((bid.total || 0) / maxDepth) * 100 : 0;
            return (
              <div
                key={`bid-${idx}`}
                className="grid grid-cols-3 gap-2 px-3 py-1 hover:bg-[#141414] transition-colors relative"
              >
                <div
                  className="absolute left-0 top-0 bottom-0 bg-green-500/10"
                  style={{ width: `${depthPercent}%` }}
                />
                <div className="text-right text-green-400 text-xs font-medium relative z-10">
                  {formatCents(bid.price)}
                </div>
                <div className="text-right text-gray-700 dark:text-[#ccc] text-xs relative z-10">
                  {bid.size.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-right text-gray-400 dark:text-[#999] text-xs relative z-10">
                  {formatTotal((bid.total || 0) * bid.price)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
