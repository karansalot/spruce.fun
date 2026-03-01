'use client';

import Header from '../components/Header';
import CLOBOrderBook from '../components/CLOBOrderBook';
import CLOBTradingPanel from '../components/CLOBTradingPanel';
import CLOBOrdersAndTrades from '../components/CLOBOrdersAndTrades';

export default function CLOBPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0f1115]">
      <Header />

      <div className="px-6 py-6">
        <div className="max-w-[1800px] mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">On-Chain Order Book</h1>
            <p className="text-sm text-gray-500 dark:text-[#8b94a3]">
              Fully on-chain CLOB on Solana Devnet — Order matching, settlement, and SPL position tokens (LONG/SHORT)
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-2xl p-4">
              <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1">On-Chain Matching</div>
              <p className="text-xs text-gray-500 dark:text-[#8b94a3]">All orders matched directly in the program on Solana</p>
            </div>
            <div className="bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-2xl p-4">
              <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1">LONG / SHORT Tokens</div>
              <p className="text-xs text-gray-500 dark:text-[#8b94a3]">Receive SPL position tokens equal to your matched order size (claim via Settle)</p>
            </div>
            <div className="bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-2xl p-4">
              <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1">USDC Collateral</div>
              <p className="text-xs text-gray-500 dark:text-[#8b94a3]">Pay in USDC on Solana Devnet — refunded on cancel</p>
            </div>
            <div className="bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-2xl p-4">
              <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Transparent</div>
              <p className="text-xs text-gray-500 dark:text-[#8b94a3]">Every order and trade is a verifiable on-chain transaction</p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
            <div className="space-y-6">
              <CLOBOrderBook />
              <CLOBOrdersAndTrades />
            </div>
            <div className="xl:sticky xl:top-6 xl:self-start space-y-6">
              <CLOBTradingPanel marketTitle="BTC/USD" />
              <div className="bg-purple-500/5 border border-purple-500/20 rounded-2xl p-4">
                <h3 className="text-sm font-semibold text-purple-300 mb-3">How It Works</h3>
                <div className="space-y-2 text-xs text-purple-200">
                  <p>1. Connect your Solana wallet (e.g. Phantom) and get devnet USDC from a faucet</p>
                  <p>2. Place buy or sell limit orders — USDC is locked as collateral</p>
                  <p>3. When orders match on-chain, call Settle to mint LONG/SHORT tokens and receive USDC refunds</p>
                  <p>4. Cancel unfilled orders to reclaim your USDC collateral</p>
                  <p>5. All transactions are visible on Solana Explorer (Devnet)</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
