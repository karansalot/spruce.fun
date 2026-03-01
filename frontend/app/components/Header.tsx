'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useState, useEffect } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { SOLANA_RPC, USDC_MINT_DEVNET, USDC_DECIMALS } from '../../lib/constants';

type MarketCategory = 'All' | 'Sports' | 'Crypto' | 'Politics';

type HeaderProps = {
  activeCategory?: MarketCategory;
  onCategoryChange?: (category: MarketCategory) => void;
};

export default function Header({ activeCategory, onCategoryChange }: HeaderProps) {
  const { publicKey, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const { resolvedTheme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [solBalance, setSolBalance] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  useEffect(() => setThemeMounted(true), []);

  const formatAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

  const fetchBalances = async () => {
    if (!publicKey) return;
    setIsLoadingBalance(true);
    try {
      const connection = new Connection(SOLANA_RPC);
      const usdcMint = new PublicKey(USDC_MINT_DEVNET);
      const [solLamports] = await Promise.all([
        connection.getBalance(publicKey),
      ]);
      setSolBalance((solLamports / 1e9).toFixed(4));

      const usdcAta = getAssociatedTokenAddressSync(usdcMint, publicKey);
      try {
        const acc = await connection.getTokenAccountBalance(usdcAta);
        const divisor = 10 ** USDC_DECIMALS;
        setUsdcBalance((Number(acc.value.amount) / divisor).toFixed(2));
      } catch {
        setUsdcBalance('0.00');
      }
    } catch (e) {
      console.error(e);
      setUsdcBalance(null);
      setSolBalance(null);
    } finally {
      setIsLoadingBalance(false);
    }
  };

  useEffect(() => {
    if (connected && publicKey) fetchBalances();
  }, [connected, publicKey?.toBase58()]);

  useEffect(() => {
    const handleRefresh = () => setTimeout(fetchBalances, 2000);
    window.addEventListener('clob-orderbook-refresh', handleRefresh);
    return () => window.removeEventListener('clob-orderbook-refresh', handleRefresh);
  }, [publicKey?.toBase58()]);

  const categories: MarketCategory[] = ['All', 'Sports', 'Crypto', 'Politics'];
  const currentCategory = activeCategory ?? 'All';
  const canChangeCategory = typeof onCategoryChange === 'function';

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-gray-200 dark:border-[#1f2430] bg-white/95 dark:bg-[#0f1115]/95 backdrop-blur">
        <div className="absolute inset-0 pointer-events-none"></div>
        <div className="relative max-w-[1800px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <Link href="/" className="flex items-center gap-1">
                  <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                    spruce.fun
                  </h1>
                </Link>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {themeMounted && (
                <button
                  onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                  className="p-2 rounded-lg bg-gray-100 dark:bg-[#1a1f28] text-gray-600 dark:text-[#7d8795] hover:text-gray-900 dark:hover:text-white transition-colors"
                  aria-label="Toggle theme"
                >
                  {resolvedTheme === 'dark' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="5" />
                      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  )}
                </button>
              )}

              <div className="relative">
                {!connected && (
                  <button
                    onClick={() => setVisible(true)}
                    className="px-5 py-2.5 bg-[#2f6df6] hover:bg-[#3a7bff] text-white font-semibold rounded-xl transition-colors shadow-[0_8px_20px_rgba(47,109,246,0.35)]"
                  >
                    Connect Wallet
                  </button>
                )}
                {connected && publicKey && (
                  <div className="flex items-center gap-3">
                    <div className="px-4 py-2 bg-gray-100 dark:bg-[#171b22] border border-gray-200 dark:border-[#262c36] rounded-xl">
                      {isLoadingBalance ? (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                          <p className="text-sm font-semibold text-gray-500 dark:text-[#7d8795]">Loading...</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          {usdcBalance !== null && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-gray-900 dark:text-white">{usdcBalance}</span>
                              <span className="text-xs font-semibold text-gray-500 dark:text-[#7d8795] uppercase">USDC</span>
                            </div>
                          )}
                          {solBalance !== null && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-gray-900 dark:text-white">{solBalance}</span>
                              <span className="text-xs font-semibold text-gray-500 dark:text-[#7d8795]">SOL</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setShowDropdown(!showDropdown)}
                      className="px-4 py-2 bg-gray-100 dark:bg-[#171b22] border border-gray-200 dark:border-[#262c36] rounded-xl hover:border-gray-300 dark:hover:border-[#364150] transition-colors"
                    >
                      <p className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                        {formatAddress(publicKey.toBase58())}
                      </p>
                    </button>
                    {showDropdown && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)}></div>
                        <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#242b36] rounded-xl shadow-2xl overflow-hidden z-50">
                          <div className="px-4 py-3 border-b border-gray-200 dark:border-[#242b36]">
                            <p className="text-xs text-gray-500 dark:text-[#7d8795]">Network</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">Solana Devnet</p>
                          </div>
                          <button
                            onClick={() => { disconnect(); setShowDropdown(false); }}
                            className="w-full px-4 py-3 text-left text-sm font-semibold text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            Disconnect
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
