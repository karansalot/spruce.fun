'use client';

import { useState, useEffect } from 'react';

interface Order {
  price: number;
  size: number;
  total?: number;
}

interface UserOrderBookData {
  bids: Order[];
  asks: Order[];
}

export default function UserOrderBook() {
  const [activeAsset, setActiveAsset] = useState<'up' | 'down'>('up');
  const [upAssetData, setUpAssetData] = useState<UserOrderBookData>({ bids: [], asks: [] });
  const [downAssetData, setDownAssetData] = useState<UserOrderBookData>({ bids: [], asks: [] });
  const [volume, setVolume] = useState<number>(0);

  // Listen for new orders from TradingPanel
  useEffect(() => {
    const handleNewOrder = (event: CustomEvent) => {
      const order = event.detail;
      const isBid = order.type === 'buy';
      const asset = order.outcome; // 'up' or 'down'
      
      const newOrder: Order = {
        price: order.limitPrice,
        size: order.shares,
      };

      // Add order to appropriate book
      if (asset === 'up') {
        setUpAssetData(prev => {
          const updated = isBid 
            ? { ...prev, bids: [...prev.bids, newOrder] }
            : { ...prev, asks: [...prev.asks, newOrder] };
          
          // Sort bids (highest first) and asks (lowest first)
          updated.bids.sort((a, b) => b.price - a.price);
          updated.asks.sort((a, b) => a.price - b.price);
          
          // Calculate totals
          let bidTotal = 0;
          updated.bids = updated.bids.map(bid => {
            bidTotal += bid.size;
            return { ...bid, total: bidTotal };
          });
          
          let askTotal = 0;
          updated.asks = updated.asks.map(ask => {
            askTotal += ask.size;
            return { ...ask, total: askTotal };
          });
          
          return updated;
        });
      } else {
        setDownAssetData(prev => {
          const updated = isBid 
            ? { ...prev, bids: [...prev.bids, newOrder] }
            : { ...prev, asks: [...prev.asks, newOrder] };
          
          updated.bids.sort((a, b) => b.price - a.price);
          updated.asks.sort((a, b) => a.price - b.price);
          
          let bidTotal = 0;
          updated.bids = updated.bids.map(bid => {
            bidTotal += bid.size;
            return { ...bid, total: bidTotal };
          });
          
          let askTotal = 0;
          updated.asks = updated.asks.map(ask => {
            askTotal += ask.size;
            return { ...ask, total: askTotal };
          });
          
          return updated;
        });
      }
    };

    window.addEventListener('newOrder' as any, handleNewOrder);
    return () => window.removeEventListener('newOrder' as any, handleNewOrder);
  }, []);

  // Update volume when active asset changes
  useEffect(() => {
    const currentData = activeAsset === 'up' ? upAssetData : downAssetData;
    if (currentData.bids.length > 0 || currentData.asks.length > 0) {
      const totalVolume = currentData.bids.reduce((sum, b) => sum + b.size, 0) + 
                         currentData.asks.reduce((sum, a) => sum + a.size, 0);
      setVolume(totalVolume);
    } else {
      setVolume(0);
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
    ...currentData.asks.map(a => a.total || 0),
    1 // Minimum to avoid division by zero
  );

  const bestAsk = currentData.asks[0]?.price;
  const bestBid = currentData.bids[0]?.price;
  const lastPrice = bestBid || bestAsk || 0;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;

  return (
    <div className="w-[380px] bg-[#1b1b1b] border border-[#333333] rounded-lg overflow-hidden shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#333333] flex-shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">My Order Book</h2>
          <button className="text-gray-400 dark:text-[#666] hover:text-gray-900 dark:hover:text-white transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1"/>
              <text x="7" y="9.5" textAnchor="middle" fontSize="8" fill="currentColor">?</text>
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 dark:text-[#999]">${volume.toFixed(0)} Vol.</span>
        </div>
      </div>

      {/* Asset Tabs */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#333333] flex-shrink-0">
        <button
          onClick={() => setActiveAsset('up')}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
            activeAsset === 'up'
              ? 'bg-gray-100 dark:bg-[#1a1a1a] text-gray-900 dark:text-white'
              : 'text-gray-400 dark:text-[#666] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#141414]'
          }`}
        >
          Trade Up
        </button>
        <button
          onClick={() => setActiveAsset('down')}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
            activeAsset === 'down'
              ? 'bg-gray-100 dark:bg-[#1a1a1a] text-gray-900 dark:text-white'
              : 'text-gray-400 dark:text-[#666] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#141414]'
          }`}
        >
          Trade Down
        </button>
      </div>

      {/* Market Summary */}
      {(lastPrice > 0 || spread > 0) && (
        <div className="px-4 py-2 border-b border-[#333333] bg-[#141414] flex-shrink-0">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400 dark:text-[#999]">
              Last: <span className="text-gray-900 dark:text-white font-medium">{formatCents(lastPrice)}</span>
            </span>
            <span className="text-gray-400 dark:text-[#999]">
              Spread: <span className="text-gray-900 dark:text-white font-medium">{formatCents(spread)}</span>
            </span>
          </div>
        </div>
      )}

      {/* Order Book Content - Side by Side */}
      <div className="flex overflow-hidden">
        {/* Bids Column */}
        <div className="flex-1 border-r border-[#333333] flex flex-col">
          {/* Bids Header */}
          <div className="px-3 py-1.5 border-b border-[#333333] flex-shrink-0">
            <div className="inline-block px-2 py-0.5 bg-green-500/20 text-green-400 text-xs font-medium rounded">
              Bids
            </div>
          </div>
          {/* Bids Table Header */}
          <div className="grid grid-cols-3 gap-2 px-3 py-1.5 text-xs text-gray-400 dark:text-[#666] border-b border-[#333333] flex-shrink-0">
            <div className="text-right">PRICE</div>
            <div className="text-right">SHARES</div>
            <div className="text-right">TOTAL</div>
          </div>
          {/* Bids List */}
          <div className="overflow-y-auto" style={{ maxHeight: '200px' }}>
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

        {/* Asks Column */}
        <div className="flex-1 flex flex-col">
          {/* Asks Header */}
          <div className="px-3 py-1.5 border-b border-[#333333] flex-shrink-0">
            <div className="inline-block px-2 py-0.5 bg-red-500/20 text-red-400 text-xs font-medium rounded">
              Asks
            </div>
          </div>
          {/* Asks Table Header */}
          <div className="grid grid-cols-3 gap-2 px-3 py-1.5 text-xs text-gray-400 dark:text-[#666] border-b border-[#333333] flex-shrink-0">
            <div className="text-right">PRICE</div>
            <div className="text-right">SHARES</div>
            <div className="text-right">TOTAL</div>
          </div>
          {/* Asks List */}
          <div className="overflow-y-auto" style={{ maxHeight: '200px' }}>
            {currentData.asks.length === 0 ? (
              <div className="px-3 py-4 text-center text-gray-400 dark:text-[#666] text-xs">No asks</div>
            ) : (
              currentData.asks.map((ask, idx) => {
                const depthPercent = maxDepth > 0 ? ((ask.total || 0) / maxDepth) * 100 : 0;
                return (
                  <div
                    key={`ask-${idx}`}
                    className="grid grid-cols-3 gap-2 px-3 py-1 hover:bg-[#141414] transition-colors relative"
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
        </div>
      </div>
    </div>
  );
}
