'use client';

import { useState, useEffect, useMemo } from 'react';

const API_URL = process.env.NEXT_PUBLIC_ORDERBOOK_API || 'https://perporderbook-production.up.railway.app';
const DEFAULT_SYMBOL = 'BTC/USD';

/**
 * PRICE PRECISION SYSTEM:
 * 
 * All calculations maintain 2 decimal places of precision for display.
 * - Prices stored as floats with full precision
 * - API expects basis points (price * 100)
 * - Display formatted to 2 decimals for user
 */

interface OrderFormData {
  side: 'long' | 'short';
  orderType: 'limit' | 'market';
  price: string;
  size: string;
  leverage: number;
}

interface MarketData {
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  volume24h: number;
}

interface PositionInfo {
  entryPrice: number;
  size: number;
  margin: number;
  leverage: number;
  liquidationPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  roe: number;
}

export default function PerpetualTradingPanel() {
  const [formData, setFormData] = useState<OrderFormData>({
    side: 'long',
    orderType: 'limit',
    price: '',
    size: '',
    leverage: 1,
  });
  
  const [marketData, setMarketData] = useState<MarketData>({
    markPrice: 50000,
    indexPrice: 50000,
    fundingRate: 0.01,
    volume24h: 1250000,
  });

  const [balance, setBalance] = useState(10000); // Mock balance in USD
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch market price
  useEffect(() => {
    const fetchMarketData = async () => {
      try {
        const response = await fetch(`${API_URL}/orderbooks/${encodeURIComponent(DEFAULT_SYMBOL)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.mid_price) {
            setMarketData(prev => ({
              ...prev,
              markPrice: data.mid_price,
              indexPrice: data.mid_price,
            }));
          }
        }
      } catch (error) {
        console.error('Failed to fetch market data:', error);
      }
    };

    fetchMarketData();
    const interval = setInterval(fetchMarketData, 3000);
    return () => clearInterval(interval);
  }, []);

  // Calculate position metrics
  const positionMetrics = useMemo(() => {
    const price = formData.orderType === 'market' 
      ? marketData.markPrice 
      : parseFloat(formData.price) || marketData.markPrice;
    
    const size = parseFloat(formData.size) || 0;
    const leverage = formData.leverage;
    
    if (size === 0 || price === 0) {
      return null;
    }

    const notionalValue = size * price;
    const margin = notionalValue / leverage;
    const fee = notionalValue * 0.0006; // 0.06% taker fee
    const totalCost = margin + fee;

    // Calculate liquidation price
    // For long: liquidation = entryPrice * (1 - 1/leverage + maintenanceMargin)
    // For short: liquidation = entryPrice * (1 + 1/leverage - maintenanceMargin)
    const maintenanceMargin = 0.005; // 0.5%
    const liquidationPrice = formData.side === 'long'
      ? price * (1 - (1 / leverage) + maintenanceMargin)
      : price * (1 + (1 / leverage) - maintenanceMargin);

    // Calculate max loss (margin)
    const maxLoss = margin;

    return {
      notionalValue,
      margin,
      fee,
      totalCost,
      liquidationPrice,
      maxLoss,
      availableBalance: balance - totalCost,
      maxSize: (balance * leverage) / price,
    };
  }, [formData, marketData.markPrice, balance]);

  const handleLeverageChange = (newLeverage: number) => {
    setFormData({ ...formData, leverage: newLeverage });
  };

  const handleMaxSize = () => {
    if (positionMetrics) {
      setFormData({ ...formData, size: positionMetrics.maxSize.toFixed(2) });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      if (!positionMetrics || positionMetrics.totalCost > balance) {
        throw new Error('Insufficient balance');
      }

      if (formData.orderType === 'market') {
        // Submit market order
        const response = await fetch(`${API_URL}/orderbooks/${encodeURIComponent(DEFAULT_SYMBOL)}/market`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            side: formData.side === 'long' ? 'buy' : 'sell',
            quantity: Math.round(parseFloat(formData.size)),
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          setMessage({
            type: 'success',
            text: `${formData.side.toUpperCase()} position opened! Size: ${data.executed_quantity}`,
          });
          setFormData({ ...formData, size: '' });
        } else {
          throw new Error(data.message || 'Failed to execute order');
        }
      } else {
        // Submit limit order
        // Convert price to basis points for 2 decimal precision
        // User enters in dollars (e.g., 50000.12), multiply by 100 for basis points
        const priceInBasisPoints = Math.round(parseFloat(formData.price) * 100);
        const response = await fetch(`${API_URL}/orderbooks/${encodeURIComponent(DEFAULT_SYMBOL)}/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            side: formData.side === 'long' ? 'buy' : 'sell',
            price: priceInBasisPoints,
            quantity: Math.round(parseFloat(formData.size)),
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          setMessage({
            type: 'success',
            text: `Limit order placed! ID: ${data.order_id.substring(0, 8)}...`,
          });
          setFormData({ ...formData, price: '', size: '' });
        } else {
          throw new Error(data.message || 'Failed to place order');
        }
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to submit order',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatPrice = (price: number) => `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatPercent = (value: number) => `${(value * 100).toFixed(2)}%`;

  return (
    <div className="w-[420px] bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-[#1f2430] bg-gradient-to-r from-white dark:from-[#12161c] to-gray-50 dark:to-[#151a22]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Perpetual Trading</h2>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-gray-400 dark:text-[#666]">Mark Price</div>
            <div className="text-gray-900 dark:text-white font-semibold">{formatPrice(marketData.markPrice)}</div>
          </div>
          <div>
            <div className="text-gray-400 dark:text-[#666]">24h Volume</div>
            <div className="text-gray-900 dark:text-white font-semibold">${(marketData.volume24h / 1000).toFixed(0)}K</div>
          </div>
          <div>
            <div className="text-gray-400 dark:text-[#666]">Funding</div>
            <div className="text-green-400 font-semibold">{formatPercent(marketData.fundingRate)}</div>
          </div>
        </div>
      </div>

      {/* Balance */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-[#1f2430] bg-gray-50 dark:bg-[#0f131a]">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-[#8b94a3]">Available Balance</span>
          <span className="text-sm font-bold text-gray-900 dark:text-white">{formatPrice(balance)}</span>
        </div>
        {positionMetrics && (
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-gray-500 dark:text-[#8b94a3]">After Order</span>
            <span className={`text-sm font-semibold ${positionMetrics.availableBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatPrice(positionMetrics.availableBalance)}
            </span>
          </div>
        )}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {/* Side Selection */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFormData({ ...formData, side: 'long' })}
            className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${
              formData.side === 'long'
                ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg shadow-green-500/30'
                : 'bg-gray-50 dark:bg-[#0f131a] text-gray-500 dark:text-[#7d8795] border border-gray-200 dark:border-[#1f2430] hover:border-green-500/30'
            }`}
          >
            LONG
          </button>
          <button
            type="button"
            onClick={() => setFormData({ ...formData, side: 'short' })}
            className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${
              formData.side === 'short'
                ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/30'
                : 'bg-gray-50 dark:bg-[#0f131a] text-gray-500 dark:text-[#7d8795] border border-gray-200 dark:border-[#1f2430] hover:border-red-500/30'
            }`}
          >
            SHORT
          </button>
        </div>

        {/* Leverage Slider */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-500 dark:text-[#8b94a3]">Leverage</label>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-gray-900 dark:text-white">{formData.leverage}x</span>
            </div>
          </div>
          <div className="relative">
            <input
              type="range"
              min="1"
              max="5"
              step="0.5"
              value={formData.leverage}
              onChange={(e) => handleLeverageChange(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 dark:bg-[#1f2430] rounded-lg appearance-none cursor-pointer slider"
              style={{
                background: `linear-gradient(to right, ${formData.side === 'long' ? '#10b981' : '#ef4444'} 0%, ${formData.side === 'long' ? '#10b981' : '#ef4444'} ${((formData.leverage - 1) / 4) * 100}%, #1f2430 ${((formData.leverage - 1) / 4) * 100}%, #1f2430 100%)`
              }}
            />
            <div className="flex justify-between mt-1 text-xs text-gray-400 dark:text-[#666]">
              <span>1x</span>
              <span>2x</span>
              <span>3x</span>
              <span>4x</span>
              <span>5x</span>
            </div>
          </div>
        </div>

        {/* Order Type */}
        <div className="flex gap-2 p-1 bg-gray-50 dark:bg-[#0f131a] rounded-lg">
          <button
            type="button"
            onClick={() => setFormData({ ...formData, orderType: 'limit' })}
            className={`flex-1 py-2 text-xs font-semibold rounded transition-colors ${
              formData.orderType === 'limit'
                ? 'bg-gray-100 dark:bg-[#1a1f28] text-gray-900 dark:text-white'
                : 'text-gray-500 dark:text-[#7d8795] hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Limit
          </button>
          <button
            type="button"
            onClick={() => setFormData({ ...formData, orderType: 'market' })}
            className={`flex-1 py-2 text-xs font-semibold rounded transition-colors ${
              formData.orderType === 'market'
                ? 'bg-gray-100 dark:bg-[#1a1f28] text-gray-900 dark:text-white'
                : 'text-gray-500 dark:text-[#7d8795] hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Market
          </button>
        </div>

        {/* Price Input (hidden for market orders) */}
        {formData.orderType === 'limit' && (
          <div>
            <label className="text-xs font-semibold text-gray-500 dark:text-[#8b94a3] mb-2 block">Price (USD)</label>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                placeholder={marketData.markPrice.toFixed(2)}
                required
                className="w-full bg-gray-50 dark:bg-[#0f131a] border border-gray-200 dark:border-[#1f2430] rounded-lg px-3 py-3 text-sm text-gray-900 dark:text-white font-mono focus:outline-none focus:border-[#3a7bff] transition-colors pr-12"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-[#666] font-semibold">
                USD
              </div>
            </div>
          </div>
        )}

        {/* Size Input */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-500 dark:text-[#8b94a3]">Size</label>
            <button
              type="button"
              onClick={handleMaxSize}
              className="text-xs font-semibold text-[#3a7bff] hover:text-[#4a8bff]"
            >
              Max: {positionMetrics ? positionMetrics.maxSize.toFixed(2) : '0.00'}
            </button>
          </div>
          <div className="relative">
            <input
              type="number"
              step="0.01"
              value={formData.size}
              onChange={(e) => setFormData({ ...formData, size: e.target.value })}
              placeholder="0.00"
              required
              className="w-full bg-gray-50 dark:bg-[#0f131a] border border-gray-200 dark:border-[#1f2430] rounded-lg px-3 py-3 text-sm text-gray-900 dark:text-white font-mono focus:outline-none focus:border-[#3a7bff] transition-colors pr-12"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-[#666] font-semibold">
              BTC
            </div>
          </div>
        </div>

        {/* Position Metrics */}
        {positionMetrics && (
          <div className="space-y-2 p-3 bg-gray-50 dark:bg-[#0f131a] rounded-lg border border-gray-200 dark:border-[#1f2430]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-[#8b94a3]">Notional Value</span>
              <span className="text-gray-900 dark:text-white font-semibold">{formatPrice(positionMetrics.notionalValue)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-[#8b94a3]">Margin Required</span>
              <span className="text-gray-900 dark:text-white font-semibold">{formatPrice(positionMetrics.margin)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-[#8b94a3]">Est. Fee (0.06%)</span>
              <span className="text-gray-900 dark:text-white font-semibold">{formatPrice(positionMetrics.fee)}</span>
            </div>
            <div className="h-px bg-gray-200 dark:bg-[#1f2430] my-2" />
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-[#8b94a3]">Total Cost</span>
              <span className="text-gray-900 dark:text-white font-bold">{formatPrice(positionMetrics.totalCost)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-[#8b94a3]">
                Liquidation Price
              </span>
              <span className="text-red-400 font-bold">{formatPrice(positionMetrics.liquidationPrice)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-[#8b94a3]">Max Loss</span>
              <span className="text-red-400 font-semibold">-{formatPrice(positionMetrics.maxLoss)}</span>
            </div>
          </div>
        )}

        {/* Warning for high leverage */}
        {formData.leverage > 3 && (
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
            <p className="text-xs text-orange-700 dark:text-orange-300">
              High leverage increases liquidation risk. Your position will be liquidated if the price moves against you by {((1 / formData.leverage) * 100).toFixed(2)}%.
            </p>
          </div>
        )}

        {/* Message Display */}
        {message && (
          <div
            className={`rounded-lg p-3 ${
              message.type === 'success'
                ? 'bg-green-500/10 border border-green-500/20'
                : 'bg-red-500/10 border border-red-500/20'
            }`}
          >
            <p
              className={`text-xs ${
                message.type === 'success' ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {message.text}
            </p>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting || !positionMetrics || positionMetrics.availableBalance < 0}
          className={`w-full py-4 text-sm font-bold rounded-lg transition-all shadow-lg ${
            formData.side === 'long'
              ? 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white shadow-green-500/30'
              : 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white shadow-red-500/30'
          } disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none`}
        >
          {isSubmitting 
            ? 'Submitting...' 
            : `Open ${formData.side === 'long' ? 'Long' : 'Short'} Position ${formData.leverage}x`
          }
        </button>
      </form>

      {/* Risk Disclaimer */}
      <div className="px-4 py-3 border-t border-gray-200 dark:border-[#1f2430] bg-gray-50 dark:bg-[#0f131a]">
        <p className="text-xs text-gray-400 dark:text-[#666] text-center">
          Perpetual trading involves high risk. Only trade with funds you can afford to lose.
        </p>
      </div>
    </div>
  );
}
