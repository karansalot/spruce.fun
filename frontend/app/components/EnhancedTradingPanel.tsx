'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import Link from 'next/link';
import { getConnection, createProgram, placeLimitOrder, placeMarketOrder, explorerTxUrl } from '../../lib/clob';
import { CLOB_PROGRAM_ID, CLOB_MARGIN_POOL, USDC_MINT_DEVNET } from '../../lib/constants';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

/**
 * PRICE PRECISION SYSTEM:
 * 
 * UI Input/Display: Users enter prices in cents with 2 decimal places (e.g., 68.12¢)
 * Backend API: Expects prices in basis points (1 basis point = 0.0001 dollars)
 * 
 * Conversion:
 * - User enters: 68.12¢ (cents)
 * - We send to API: 6812 basis points (68.12 * 100)
 * - API interprets: 6812 basis points = $0.6812
 * 
 * This system provides 2 decimal places of precision for display.
 * All intermediate calculations maintain full floating point precision.
 * Rounding only occurs when converting to API format or displaying to user.
 */

interface TeamOutcome {
  name: string;
  key: string;
  price: number;
  bestBid?: number;
  bestAsk?: number;
  image?: string;
}

interface EnhancedTradingPanelProps {
  symbol?: string;
  marketTitle?: string;
  marketIcon?: string;
  upPrice?: number;
  downPrice?: number;
  selectedOutcome?: string;
  marketType?: 'binary' | 'multi';
  teams?: TeamOutcome[];
}

export default function EnhancedTradingPanel({
  symbol,
  marketTitle,
  marketIcon,
  upPrice = 0,
  downPrice = 0,
  selectedOutcome,
  marketType = 'binary',
  teams = [],
}: EnhancedTradingPanelProps) {
  const wallet = useWallet();
  const { connected, publicKey } = wallet;

  // Trading state
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [amount, setAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [leverage, setLeverage] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string; txHash?: string } | null>(null);
  const [orderTypeDropdownOpen, setOrderTypeDropdownOpen] = useState(false);
  const [leverageDropdownOpen, setLeverageDropdownOpen] = useState(false);

  const LEVERAGE_OPTIONS = [1, 2, 3, 4, 5] as const;

  // Get current price based on side and market type
  const getCurrentPrice = () => {
    if (marketType === 'binary') {
      return side === 'long' ? upPrice : downPrice;
    } else {
      const team = teams.find(t => t.key === selectedOutcome);
      if (!team) return 0;
      return side === 'long' ? (team.bestAsk || team.price) : (team.bestBid || team.price);
    }
  };

  const currentPrice = getCurrentPrice();
  const displayPrice = currentPrice > 0 ? (currentPrice * 100).toFixed(2) : '0.00';

  // Total cost = margin only: limit price × amount (not leveraged). You pay this on-chain.
  const calculateTotal = () => {
    const amountNum = parseFloat(amount) || 0;
    const priceNum = orderType === 'limit' ? (parseFloat(limitPrice) / 100) : currentPrice;
    return amountNum * priceNum;
  };

  // Calculate liquidation price
  const calculateLiquidationPrice = () => {
    if (leverage === 1) return null; // No liquidation at 1x

    // For limit orders, limitPrice is in cents, need to convert to dollars
    // For market orders, currentPrice is already in dollars
    const entryPrice = orderType === 'limit' ? (parseFloat(limitPrice) / 100) : currentPrice;
    if (!entryPrice || entryPrice === 0) return null;

    // Liquidation happens when position loses (100 / leverage)% of value
    // For long: liquidation price = entry * (1 - 1/leverage)
    // For short: liquidation price = entry * (1 + 1/leverage)
    const liquidationThreshold = 1 / leverage;

    let liqPrice;
    if (side === 'long') {
      // Long position liquidates when price drops
      liqPrice = entryPrice * (1 - liquidationThreshold);
    } else {
      // Short position liquidates when price rises
      liqPrice = entryPrice * (1 + liquidationThreshold);
    }

    return liqPrice;
  };

  const liquidationPrice = calculateLiquidationPrice();
  const totalCost = calculateTotal();

  // Format for display with 2 decimal precision
  const totalCostFormatted = typeof totalCost === 'number' && !isNaN(totalCost) && totalCost > 0
    ? totalCost.toFixed(2)
    : null;

  // Check if entry price is valid
  const entryPrice = orderType === 'limit'
    ? (parseFloat(limitPrice) || 0)
    : (currentPrice * 100);
  const hasValidEntryPrice = entryPrice > 0;
  const hasValidAmount = parseFloat(amount || '0') > 0;

  // Format number with smart decimal handling
  const formatNumber = (num: number) => {
    const rounded = num.toFixed(2);
    if (rounded.endsWith('.00')) {
      return Math.floor(num).toString();
    }
    return rounded;
  };

  // For multi markets: selected outcome (team) icon + name; for binary: market icon + title
  const selectedTeam = marketType === 'multi' && selectedOutcome
    ? teams.find(t => t.key === selectedOutcome)
    : null;
  const headerIcon = selectedTeam?.image ?? marketIcon;
  const headerName = selectedTeam?.name ?? marketTitle ?? 'Trade';

  // Update limit price when current price changes (only if not manually edited)
  useEffect(() => {
    if (orderType === 'limit' && currentPrice > 0 && !limitPrice) {
      setLimitPrice((currentPrice * 100).toFixed(2));
    }
  }, [currentPrice, orderType]);

  // Listen for orderbook price clicks - update limit price and amount (shares from asks only)
  useEffect(() => {
    const handleOrderbookPriceClick = (event: CustomEvent<{ asset: string; price: number; shares: number | null }>) => {
      const { price, shares } = event.detail;
      setLimitPrice(price.toFixed(2));
      if (shares != null) {
        setAmount(shares.toString());
      }
      setOrderType('limit');
    };
    window.addEventListener('orderbookPriceClick', handleOrderbookPriceClick as EventListener);
    return () => window.removeEventListener('orderbookPriceClick', handleOrderbookPriceClick as EventListener);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !publicKey) {
      setMessage({ type: 'error', text: 'Connect your Solana wallet to place orders.' });
      return;
    }
    if (!CLOB_PROGRAM_ID) {
      setMessage({ type: 'error', text: 'On-chain orderbook is not configured. Use the CLOB page or set NEXT_PUBLIC_CLOB_PROGRAM_ID.' });
      return;
    }

    const amountNum = parseFloat(amount) || 0;
    if (amountNum <= 0) {
      setMessage({ type: 'error', text: 'Enter a quantity greater than 0.' });
      return;
    }
    // Margin trading: user enters margin (e.g. 1 share), pays amount × price; order book shows leveraged size (amount × leverage).
    const lev = Math.min(10, Math.max(1, leverage));
    const orderQty = Math.max(1, Math.round(amountNum * lev));
    const marginPoolPubkey = CLOB_MARGIN_POOL ? new PublicKey(CLOB_MARGIN_POOL) : undefined;
    if (lev > 1 && !marginPoolPubkey) {
      setMessage({ type: 'error', text: 'Leverage > 1 requires NEXT_PUBLIC_CLOB_MARGIN_POOL to be set (margin pool pubkey).' });
      return;
    }

    if (orderType === 'limit') {
      const priceNum = parseFloat(limitPrice);
      if (!priceNum || priceNum <= 0 || priceNum >= 100) {
        setMessage({ type: 'error', text: 'Limit price must be between 0.01¢ and 99.99¢.' });
        return;
      }
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const connection = getConnection();
      const program = createProgram(connection, wallet);
      if (!program) {
        setMessage({ type: 'error', text: 'Wallet not ready. Try reconnecting.' });
        setIsSubmitting(false);
        return;
      }

      const usdcMint = new PublicKey(USDC_MINT_DEVNET);
      const userUsdc = getAssociatedTokenAddressSync(usdcMint, publicKey);
      const isBuy = side === 'long';

      if (orderType === 'market') {
        const sig = await placeMarketOrder(program, userUsdc, isBuy, BigInt(orderQty), lev, marginPoolPubkey);
        setMessage({ type: 'success', text: `Market ${isBuy ? 'buy' : 'sell'} order submitted!`, txHash: sig });
        setAmount('');
      } else {
        const priceBp = BigInt(Math.round(parseFloat(limitPrice) * 100));
        const sig = await placeLimitOrder(program, userUsdc, isBuy, priceBp, BigInt(orderQty), lev, marginPoolPubkey);
        setMessage({ type: 'success', text: `Limit ${isBuy ? 'buy' : 'sell'} order placed!`, txHash: sig });
        setLimitPrice('');
        setAmount('');
      }

      window.dispatchEvent(new Event('clob-orderbook-refresh'));
      setTimeout(() => window.dispatchEvent(new Event('clob-orderbook-refresh')), 2000);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to submit order';
      setMessage({ type: 'error', text: msg });
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <div className="bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-xl p-4">
      {/* Header: selected outcome (team) icon + name, or market icon + title for binary */}
      <div className="mb-3 flex items-center gap-2">
        {headerIcon && (
          <img
            src={headerIcon}
            alt=""
            className="w-8 h-8 rounded-lg object-cover shrink-0 bg-gray-100 dark:bg-[#1a1f28]"
          />
        )}
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
          {headerName}
        </h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Long/Short + Market/Limit on one line */}
        <div className="flex items-center gap-2">
          <div className="grid grid-cols-2 gap-1 p-0.5 bg-gray-50 dark:bg-[#0a0e14] rounded-lg flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setSide('long')}
              className={`py-1.5 rounded-md font-semibold text-xs transition-all ${side === 'long'
                ? 'bg-[#15803d] text-white shadow-lg'
                : 'text-gray-500 dark:text-[#8b94a3] hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              Long
            </button>
            <button
              type="button"
              onClick={() => setSide('short')}
              className={`py-1.5 rounded-md font-semibold text-xs transition-all ${side === 'short'
                ? 'bg-[#991b1b] text-white shadow-lg'
                : 'text-gray-500 dark:text-[#8b94a3] hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              Short
            </button>
          </div>
          <div
            className="relative shrink-0 w-[100px]"
            onMouseEnter={() => setOrderTypeDropdownOpen(true)}
            onMouseLeave={() => setOrderTypeDropdownOpen(false)}
          >
            <button
              type="button"
              onClick={() => setOrderType(orderType === 'limit' ? 'market' : 'limit')}
              className="w-full bg-gray-50 dark:bg-[#0a0e14] border border-gray-200 dark:border-[#1f2430] rounded-lg px-3 py-1.5 text-gray-900 dark:text-white font-medium text-xs focus:outline-none focus:border-blue-500 transition-colors cursor-pointer text-left flex items-center justify-between"
            >
              <span>{orderType === 'market' ? 'Market' : 'Limit'}</span>
              <svg className="w-4 h-4 text-gray-500 dark:text-[#8b94a3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {orderTypeDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-gray-50 dark:bg-[#0a0e14] border border-gray-200 dark:border-[#1f2430] rounded-lg shadow-lg z-10 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOrderType('market')}
                  className={`w-full px-3 py-1.5 text-left text-xs font-medium transition-colors ${orderType === 'market' ? 'bg-gray-100 dark:bg-[#1a1f28] text-gray-900 dark:text-white' : 'text-gray-500 dark:text-[#8b94a3] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#1a1f28]'
                    }`}
                >
                  Market
                </button>
                <button
                  type="button"
                  onClick={() => setOrderType(orderType === 'limit' ? 'market' : 'limit')}
                  className={`w-full px-3 py-1.5 text-left text-xs font-medium transition-colors ${orderType === 'limit' ? 'bg-gray-100 dark:bg-[#1a1f28] text-gray-900 dark:text-white' : 'text-gray-500 dark:text-[#8b94a3] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#1a1f28]'
                    }`}
                >
                  Limit
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Current Price Display */}
        <div className="bg-gray-50 dark:bg-[#0a0e14] rounded-lg px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500 dark:text-[#8b94a3]">
              {orderType === 'market' ? 'Market Price' : 'Current Price'}
            </span>
            <span className="text-sm font-bold text-gray-900 dark:text-white">
              {displayPrice}¢
            </span>
          </div>
        </div>

        {/* Limit Price Input (only for limit orders) */}
        {orderType === 'limit' && (
          <div>
            <label className="block text-[11px] text-gray-500 dark:text-[#8b94a3] mb-1">
              Limit Price (¢)
            </label>
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0.01"
              max="99.99"
              className="w-full bg-gray-50 dark:bg-[#0a0e14] border border-gray-200 dark:border-[#1f2430] rounded-lg px-3 py-2 text-gray-900 dark:text-white text-sm font-medium focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        )}

        {/* Amount Input */}
        <div>
          <label className="block text-[11px] text-gray-500 dark:text-[#8b94a3] mb-1">
            Amount (Shares)
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0.01"
            step="0.01"
            className="w-full bg-gray-50 dark:bg-[#0a0e14] border border-gray-200 dark:border-[#1f2430] rounded-lg px-3 py-2 text-gray-900 dark:text-white text-sm font-medium focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Leverage Selector - dropdown on hover, single line */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Leverage</h3>
          <div
            className="relative w-[88px] shrink-0"
            onMouseEnter={() => setLeverageDropdownOpen(true)}
            onMouseLeave={() => setLeverageDropdownOpen(false)}
          >
            <button
              type="button"
              className="w-full bg-gray-50 dark:bg-[#0a0e14] border border-gray-200 dark:border-[#1f2430] rounded-lg px-3 py-1.5 text-gray-900 dark:text-white font-medium text-xs focus:outline-none focus:border-blue-500 transition-colors cursor-pointer text-left flex items-center justify-between"
            >
              <span>{leverage}x</span>
              <svg className="w-3 h-3 text-gray-500 dark:text-[#8b94a3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {leverageDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-gray-50 dark:bg-[#0a0e14] border border-gray-200 dark:border-[#1f2430] rounded-lg shadow-lg z-10 overflow-hidden">
                {LEVERAGE_OPTIONS.map((lev) => (
                  <button
                    key={lev}
                    type="button"
                    onClick={() => setLeverage(lev)}
                    className={`w-full px-3 py-1.5 text-left text-xs font-medium transition-colors ${leverage === lev ? 'bg-gray-100 dark:bg-[#1a1f28] text-gray-900 dark:text-white' : 'text-gray-500 dark:text-[#8b94a3] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#1a1f28]'}`}
                  >
                    {lev}x
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Position Summary */}
        <div className="bg-gray-50 dark:bg-[#0a0e14] rounded-lg px-3 py-2 border border-gray-200 dark:border-[#1f2430] space-y-1.5">
          {/* Entry Price */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500 dark:text-[#8b94a3]">Entry Price</span>
            {hasValidEntryPrice ? (
              <span className="text-xs font-semibold text-gray-900 dark:text-white">
                {orderType === 'limit'
                  ? `${parseFloat(limitPrice).toFixed(2)}¢`
                  : `${parseFloat(displayPrice).toFixed(2)}¢`
                }
              </span>
            ) : (
              <span className="text-xs font-medium text-gray-400 dark:text-[#666]">
                {orderType === 'limit' ? 'Enter limit price' : 'Loading...'}
              </span>
            )}
          </div>

          {/* Position Size */}
          {leverage > 1 && hasValidAmount && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500 dark:text-[#8b94a3]">Position Size</span>
              <span className="text-xs font-semibold text-gray-900 dark:text-white">
                {formatNumber(parseFloat(amount) * leverage)} shares
              </span>
            </div>
          )}

          {/* Liquidation Price */}
          {liquidationPrice !== null && hasValidAmount && hasValidEntryPrice && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500 dark:text-[#8b94a3]">Liq. Price</span>
              <span className={`text-xs font-semibold ${side === 'long' ? 'text-red-400' : 'text-red-400'
                }`}>
                {(liquidationPrice * 100).toFixed(2)}¢
              </span>
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-gray-200 dark:border-[#1f2430] pt-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500 dark:text-[#8b94a3]">Total Cost</span>
              {totalCostFormatted !== null ? (
                <span className="text-lg font-bold text-gray-900 dark:text-white">
                  ${totalCostFormatted}
                </span>
              ) : (
                <span className="text-sm font-medium text-gray-400 dark:text-[#666]">
                  {!hasValidEntryPrice && orderType === 'limit' ? '—' :
                    !hasValidAmount ? '—' :
                      '$0.00'}
                </span>
              )}
            </div>
            {!hasValidEntryPrice && orderType === 'limit' && (
              <p className="text-[10px] text-gray-400 dark:text-[#666] text-right">Enter limit price above</p>
            )}
            {!hasValidAmount && hasValidEntryPrice && (
              <p className="text-[10px] text-gray-400 dark:text-[#666] text-right">Enter amount above</p>
            )}
            {totalCostFormatted !== null && (
              <p className="text-[10px] text-gray-400 dark:text-[#666] text-right mt-0.5">
                You pay this (Limit price × Amount). Leverage is for display only.
              </p>
            )}
          </div>

          {/* Risk Warning */}
          {leverage > 1 && hasValidAmount && hasValidEntryPrice && liquidationPrice !== null && (
            <div className="pt-1 border-t border-gray-200 dark:border-[#1f2430]">
              <p className="text-[10px] text-gray-500 dark:text-[#8b94a3] leading-snug">
                {leverage}x leverage: Liq. if price {side === 'long' ? 'drops to' : 'rises to'} {(liquidationPrice * 100).toFixed(2)}¢
              </p>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !connected}
          className={`w-full py-2.5 rounded-lg font-bold text-sm transition-all ${side === 'long'
            ? 'bg-[#15803d] hover:bg-[#16a34a] text-white'
            : 'bg-[#991b1b] hover:bg-[#dc2626] text-white'
            } ${(isSubmitting || !connected) && 'opacity-50 cursor-not-allowed'
            }`}
        >
          {!connected
            ? 'Connect Wallet'
            : isSubmitting
              ? 'Submitting...'
              : `${side === 'long' ? 'Long' : 'Short'} ${orderType === 'market' ? 'Market' : 'Limit'}`}
        </button>

        <p className="text-xs text-gray-500 dark:text-[#8b94a3] text-center">
          {CLOB_PROGRAM_ID ? (
            <>Orders are placed on-chain (Solana). <Link href="/clob" className="text-blue-400 hover:underline">Open CLOB page</Link></>
          ) : (
            <>On-chain orders: <Link href="/clob" className="text-blue-400 hover:underline">Go to CLOB page</Link></>
          )}
        </p>

        {/* Message Display */}
        {message && (
          <div
            className={`p-3 rounded-lg text-sm ${message.type === 'success'
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
              }`}
          >
            {message.text}
            {message.txHash && (
              <a
                href={explorerTxUrl(message.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-purple-400 hover:text-purple-300 underline mt-1"
              >
                View on Solana Explorer
              </a>
            )}
          </div>
        )}

      </form>
    </div>
  );
}
