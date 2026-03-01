'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

const API_URL = process.env.NEXT_PUBLIC_ORDERBOOK_API || 'https://perporderbook-production.up.railway.app';

interface CLOBTestOrdersProps {
  symbol: string;
}

export default function CLOBTestOrders({ symbol }: CLOBTestOrdersProps) {
  const { authenticated, user } = usePrivy();
  const [isPopulating, setIsPopulating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const populateOrderbook = async () => {
    setIsPopulating(true);
    setMessage(null);

    try {
      // Create a realistic orderbook with bid/ask spread
      const basePrice = 5000; // Base price in cents ($50.00)
      const orders = [];
      const walletAddress = authenticated && user?.wallet?.address ? user.wallet.address : undefined;

      // Add bid orders (buy orders below market price)
      for (let i = 0; i < 10; i++) {
        const price = basePrice - (i + 1) * 10; // Decreasing prices
        const quantity = 10 + i * 5;
        orders.push({
          side: 'buy',
          price,
          quantity,
          wallet_address: walletAddress,
        });
      }

      // Add ask orders (sell orders above market price)
      for (let i = 0; i < 10; i++) {
        const price = basePrice + (i + 1) * 10; // Increasing prices
        const quantity = 10 + i * 5;
        orders.push({
          side: 'sell',
          price,
          quantity,
          wallet_address: walletAddress,
        });
      }

      // Submit all orders
      let successCount = 0;
      for (const order of orders) {
        const response = await fetch(`${API_URL}/orderbooks/${encodeURIComponent(symbol)}/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(order),
        });

        if (response.ok) {
          successCount++;
        }
      }

      setMessage({
        type: 'success',
        text: `Successfully placed ${successCount}/${orders.length} orders. Orderbook will update automatically.`,
      });
      // Trigger immediate orderbook refresh
      window.dispatchEvent(new Event('clob-orderbook-refresh'));
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to populate orderbook',
      });
    } finally {
      setIsPopulating(false);
    }
  };

  const clearOrderbook = async () => {
    if (!confirm('Are you sure you want to clear all orders?')) {
      return;
    }

    setIsPopulating(true);
    setMessage(null);

    try {
      // Get all orders
      const response = await fetch(`${API_URL}/orderbooks/${encodeURIComponent(symbol)}/orders/all`);
      if (!response.ok) {
        throw new Error('Failed to fetch orders');
      }

      const data = await response.json();
      const orders = data.orders || [];

      // Cancel all orders
      let successCount = 0;
      for (const order of orders) {
        const cancelResponse = await fetch(
          `${API_URL}/orderbooks/${encodeURIComponent(symbol)}/orders/${order.order_id}`,
          { method: 'POST' }
        );

        if (cancelResponse.ok) {
          successCount++;
        }
      }

      setMessage({
        type: 'success',
        text: `Cancelled ${successCount}/${orders.length} orders`,
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to clear orderbook',
      });
    } finally {
      setIsPopulating(false);
    }
  };

  return (
    <div className="bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-2xl p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Testing Tools</h3>
      
      <div className="space-y-3">
        <button
          onClick={populateOrderbook}
          disabled={isPopulating}
          className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPopulating ? 'Populating...' : 'Populate Test Orders'}
        </button>

        <button
          onClick={clearOrderbook}
          disabled={isPopulating}
          className="w-full px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-red-500/30"
        >
          Clear All Orders
        </button>

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

        <div className="text-xs text-gray-400 dark:text-[#666] mt-4">
          <p>• Creates 20 test orders (10 bids, 10 asks)</p>
          <p>• Base price: $50.00 with $0.10 increments</p>
          <p>• Useful for testing the orderbook display</p>
        </div>
      </div>
    </div>
  );
}
