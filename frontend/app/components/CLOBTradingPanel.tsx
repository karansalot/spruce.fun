'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { getConnection, createProgram, placeLimitOrder, placeMarketOrder, explorerTxUrl } from '../../lib/clob';
import { CLOB_PROGRAM_ID, USDC_MINT_DEVNET } from '../../lib/constants';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

interface OrderFormData {
  side: 'buy' | 'sell';
  price: string;
  quantity: string;
  orderType: 'limit' | 'market';
}

interface CLOBTradingPanelProps {
  symbol?: string;
  marketTitle?: string;
}

export default function CLOBTradingPanel({ marketTitle }: CLOBTradingPanelProps) {
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
  const [formData, setFormData] = useState<OrderFormData>({
    side: 'buy',
    price: '',
    quantity: '',
    orderType: 'limit',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string; txHash?: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !publicKey) {
      setMessage({ type: 'error', text: 'Please connect your Solana wallet to place orders' });
      return;
    }
    if (!CLOB_PROGRAM_ID) {
      setMessage({ type: 'error', text: 'Orderbook program not configured' });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const connection = getConnection();
      const program = createProgram(connection, wallet);
      if (!program) {
        setMessage({ type: 'error', text: 'Wallet not ready' });
        setIsSubmitting(false);
        return;
      }

      const usdcMint = new PublicKey(USDC_MINT_DEVNET);
      const userUsdc = getAssociatedTokenAddressSync(usdcMint, publicKey);

      const isBuy = formData.side === 'buy';

      if (formData.orderType === 'market') {
        const qty = Math.max(1, Math.round(parseFloat(formData.quantity) || 0));
        if (qty <= 0) {
          setMessage({ type: 'error', text: 'Please enter a quantity greater than 0' });
          setIsSubmitting(false);
          return;
        }
        const sig = await placeMarketOrder(program, userUsdc, isBuy, BigInt(qty));
        setMessage({ type: 'success', text: `Market ${isBuy ? 'buy' : 'sell'} order submitted!`, txHash: sig });
        setFormData({ ...formData, quantity: '' });
      } else {
        const priceFloat = parseFloat(formData.price);
        const qty = parseInt(formData.quantity, 10);
        if (!priceFloat || priceFloat <= 0 || priceFloat >= 100) {
          setMessage({ type: 'error', text: 'Price must be between 0.01¢ and 99.99¢' });
          setIsSubmitting(false);
          return;
        }
        if (!qty || qty <= 0) {
          setMessage({ type: 'error', text: 'Quantity must be a positive integer' });
          setIsSubmitting(false);
          return;
        }
        const priceBp = BigInt(Math.round(priceFloat * 100));
        const sig = await placeLimitOrder(program, userUsdc, isBuy, priceBp, BigInt(qty));
        setMessage({ type: 'success', text: `Limit ${isBuy ? 'buy' : 'sell'} order placed!`, txHash: sig });
        setFormData({ ...formData, price: '', quantity: '' });
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
    <div className="w-[380px] bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-[#1f2430]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Place Order</h2>
            <p className="text-xs text-gray-500 dark:text-[#8b94a3] mt-0.5">{marketTitle || 'BTC/USD'}</p>
          </div>
          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-400 rounded">SOLANA</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFormData({ ...formData, side: 'buy' })}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
              formData.side === 'buy'
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-gray-50 dark:bg-[#0f131a] text-gray-500 dark:text-[#7d8795] border border-gray-200 dark:border-[#1f2430] hover:border-gray-300 dark:hover:border-[#2a3040]'
            }`}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => setFormData({ ...formData, side: 'sell' })}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
              formData.side === 'sell'
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : 'bg-gray-50 dark:bg-[#0f131a] text-gray-500 dark:text-[#7d8795] border border-gray-200 dark:border-[#1f2430] hover:border-gray-300 dark:hover:border-[#2a3040]'
            }`}
          >
            Sell
          </button>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 dark:text-[#8b94a3] mb-2 block">Order Type</label>
          <select
            value={formData.orderType}
            onChange={(e) => setFormData({ ...formData, orderType: e.target.value as 'limit' | 'market' })}
            className="w-full bg-gray-50 dark:bg-[#0f131a] border border-gray-200 dark:border-[#1f2430] rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#3a7bff] transition-colors"
          >
            <option value="limit">Limit Order</option>
            <option value="market">Market Order</option>
          </select>
        </div>

        {formData.orderType !== 'market' && (
          <div>
            <label className="text-xs font-semibold text-gray-500 dark:text-[#8b94a3] mb-2 block">Price (¢)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="99.99"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              placeholder="0.00"
              required
              className="w-full bg-gray-50 dark:bg-[#0f131a] border border-gray-200 dark:border-[#1f2430] rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white font-mono focus:outline-none focus:border-[#3a7bff] transition-colors"
            />
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-500 dark:text-[#8b94a3] mb-2 block">Quantity (Shares)</label>
          <input
            type="number"
            step="1"
            min="1"
            value={formData.quantity}
            onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
            placeholder="0"
            required
            className="w-full bg-gray-50 dark:bg-[#0f131a] border border-gray-200 dark:border-[#1f2430] rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white font-mono focus:outline-none focus:border-[#3a7bff] transition-colors"
          />
        </div>

        <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-3">
          <p className="text-xs text-purple-600 dark:text-purple-300">
            {formData.orderType === 'limit'
              ? 'Limit orders are placed on-chain. USDC collateral is locked until filled or cancelled.'
              : 'Market orders execute immediately at the best available on-chain price.'}
          </p>
          {formData.orderType === 'limit' && formData.price && formData.quantity && (
            <p className="text-xs text-purple-400 mt-1 font-mono">
              Collateral: ~$
              {(
                ((formData.side === 'buy' ? parseFloat(formData.price) : 100 - parseFloat(formData.price)) *
                  parseInt(formData.quantity || '0', 10)) /
                100
              ).toFixed(2)}{' '}
              USDC
            </p>
          )}
        </div>

        {message && (
          <div
            className={`rounded-lg p-3 ${
              message.type === 'success' ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'
            }`}
          >
            <p className={`text-xs ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>{message.text}</p>
            {message.txHash && (
              <a href={explorerTxUrl(message.txHash)} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-400 hover:text-purple-300 underline mt-1 inline-block">
                View on Explorer
              </a>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !connected}
          className={`w-full py-3 text-sm font-semibold rounded-lg transition-colors ${
            formData.side === 'buy' ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-red-500 hover:bg-red-600 text-white'
          } disabled:opacity-50 disabled:cursor-not-allowed shadow-lg`}
        >
          {!connected ? 'Connect Wallet' : isSubmitting ? 'Confirming...' : `Place ${formData.side === 'buy' ? 'Buy' : 'Sell'} Order`}
        </button>
      </form>
    </div>
  );
}
