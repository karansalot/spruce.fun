'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from './components/Header';
import MarketCard from './components/MarketCard';

type MarketCategory = 'All' | 'Sports' | 'Crypto' | 'Politics';

type MarketOutcome = {
  label: string;
  percent: number;
};

type MarketCardData =
  | {
      variant: 'multi';
      outcomes: MarketOutcome[];
      title: string;
      slug: string;
      category: 'Sports' | 'Crypto';
      volume: string;
      icon: string | null;
      subtitle?: string;
    }
  | {
      variant: 'binary';
      percent: number;
      primaryLabel: string;
      secondaryLabel: string;
      statusLabel?: string;
      title: string;
      slug: string;
      category: 'Sports' | 'Crypto';
      volume: string;
      icon: string | null;
      subtitle?: string;
    };

export default function Home() {
  const [activeCategory, setActiveCategory] = useState<MarketCategory>('All');
  const [markets, setMarkets] = useState<MarketCardData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const loadMarkets = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const response = await fetch('/api/markets');
        if (!response.ok) {
          throw new Error('Failed to load markets');
        }
        const data = await response.json();
        setMarkets(data.markets ?? []);
      } catch (error: any) {
        setLoadError(error.message ?? 'Failed to load markets');
      } finally {
        setIsLoading(false);
      }
    };

    loadMarkets();
  }, []);

  const visibleMarkets = useMemo(() => {
    if (activeCategory === 'All') {
      return markets;
    }
    return markets.filter((market) => market.category === activeCategory);
  }, [activeCategory, markets]);

  return (
    <div className="min-h-screen bg-white dark:bg-[#0f1115]">
      <Header activeCategory={activeCategory} onCategoryChange={setActiveCategory} />

      <div className="px-6 py-6">
        <div className="max-w-[1600px] mx-auto">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Trending markets</h2>
            <p className="text-sm text-gray-500 dark:text-[#8b94a3] mt-1">
              Browse top markets across sports and crypto.
            </p>
          </div>

          {isLoading ? (
            <div className="rounded-2xl border border-gray-200 dark:border-[#1f2430] bg-white dark:bg-[#12161c] p-10 text-center text-sm text-gray-500 dark:text-[#7d8795]">
              Loading markets...
            </div>
          ) : loadError ? (
            <div className="rounded-2xl border border-red-200 dark:border-[#342026] bg-red-50 dark:bg-[#1a1116] p-10 text-center text-sm text-red-600 dark:text-red-300">
              {loadError}
            </div>
          ) : visibleMarkets.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 dark:border-[#1f2430] bg-white dark:bg-[#12161c] p-10 text-center text-sm text-gray-500 dark:text-[#7d8795]">
              No markets available for this category yet.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleMarkets.map((market) => (
                <MarketCard key={market.slug} {...market} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
