'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Header from '../../components/Header';
import CandlestickChart from '../../components/CandlestickChart';
import LineChart from '../../components/LineChart';
import TeamSelector from '@/app/components/TeamSelector';
import EnhancedTradingPanel from '../../components/EnhancedTradingPanel';
import CLOBOrdersAndTrades from '../../components/CLOBOrdersAndTrades';
import { useCLOBOrderbook } from '../../hooks/useCLOBOrderbook';
import { getConfigForSlug } from '@/lib/marketConfig';

interface TeamOutcome {
  name: string;
  key: string;
  price: number;
  bestBid?: number;
  bestAsk?: number;
  image?: string;
  /** CLOB token ID for Polymarket getPricesHistory chart data */
  tokenId?: string;
  /** CLOB token ID for the No side */
  noTokenId?: string;
}

/** Outcome string to key (e.g. "Seattle Yes" -> "seattle_yes"). */
function outcomeToKey(outcome: string): string {
  return outcome.toLowerCase().replace(/\s+/g, '_');
}

export default function MarketPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [activeAsset, setActiveAsset] = useState<string | null>(null);
  const [activeOrderbook, setActiveOrderbook] = useState<string | null>(null);
  const [upPrice, setUpPrice] = useState<number>(0);
  const [downPrice, setDownPrice] = useState<number>(0);
  const [marketType, setMarketType] = useState<'binary' | 'multi'>('binary');
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');
  const [teams, setTeams] = useState<TeamOutcome[]>([]);
  const [marketTitle, setMarketTitle] = useState<string>('');
  const [marketImage, setMarketImage] = useState<string>('');
  const [marketSubtitle, setMarketSubtitle] = useState<string>('');
  const [isLoadingMarket, setIsLoadingMarket] = useState<boolean>(true);

  const config = typeof slug === 'string' ? getConfigForSlug(slug) : undefined;

  const { symbol: clobSymbol } = useCLOBOrderbook({
    slug,
    marketType,
    outcome: (marketType === 'multi' ? activeOrderbook : activeAsset) || undefined,
    autoInitialize: true,
  });

  // Fetch market data from our per-market API route (Polymarket via Next.js)
  useEffect(() => {
    const fetchMarketInfo = async () => {
      setIsLoadingMarket(true);
      try {
        const response = await fetch(`/api/markets/${slug}`);
        if (response.ok) {
          const data = await response.json();
          setMarketTitle(data.title || '');
          setMarketImage(data.icon || '');
          setMarketSubtitle(data.subtitle || '');

          if (data.variant === 'multi' && data.outcomes?.length) {
            setMarketType('multi');
            const teamOutcomes: TeamOutcome[] = data.outcomes.flatMap((outcome: any) => {
              const baseKey = outcomeToKey(outcome.label);
              const baseName = outcome.label;
              const price = (outcome.percent ?? 0) / 100;
              const image = outcome.image || data.icon;
              return [
                {
                  name: `${baseName} Yes`,
                  key: `${baseKey}_yes`,
                  price,
                  image,
                  tokenId: outcome.tokenId,
                },
                {
                  name: `${baseName} No`,
                  key: `${baseKey}_no`,
                  price: 1 - price,
                  image,
                  tokenId: outcome.noTokenId,
                },
              ];
            });
            setTeams(teamOutcomes);
            setActiveAsset(teamOutcomes[0].key);
            setActiveOrderbook(teamOutcomes[0].key);
          } else {
            setMarketType('binary');
            setActiveAsset('up');
            setActiveOrderbook(null);
          }
          setIsLoadingMarket(false);
          return;
        }

        // Fallback: use local config if API fails
        if (config) {
          setMarketTitle(slug.replace(/-/g, ' '));
          if (config.type === 'multi' && config.outcomeLabels?.length) {
            setMarketType('multi');
            const teamOutcomes: TeamOutcome[] = config.outcomeLabels.map((label) => ({
              name: label,
              key: outcomeToKey(label),
              price: 0,
              image: config.teamImages?.[label],
            }));
            setTeams(teamOutcomes);
            setActiveAsset(teamOutcomes[0].key);
            setActiveOrderbook(teamOutcomes[0].key);
          } else {
            setMarketType('binary');
            setActiveAsset('up');
            setActiveOrderbook(null);
          }
        } else {
          setMarketType('binary');
          setActiveAsset('up');
          setActiveOrderbook(null);
        }
      } catch {
        // Fallback: use local config
        if (config?.type === 'multi' && config.outcomeLabels?.length) {
          setMarketType('multi');
          const teamOutcomes: TeamOutcome[] = config.outcomeLabels.map((label) => ({
            name: label,
            key: outcomeToKey(label),
            price: 0,
            image: config.teamImages?.[label],
          }));
          setTeams(teamOutcomes);
          setActiveAsset(teamOutcomes[0].key);
          setActiveOrderbook(teamOutcomes[0].key);
        } else {
          setMarketType('binary');
          setActiveAsset('up');
          setActiveOrderbook(null);
        }
      } finally {
        setIsLoadingMarket(false);
      }
    };

    fetchMarketInfo();
  }, [slug, config]);

  useEffect(() => {
    const handlePriceUpdate = (event: any) => {
      const { asset, price, bestBid, bestAsk } = event.detail;
      if (asset === 'up') setUpPrice(price);
      else if (asset === 'down') setDownPrice(price);
      if (marketType === 'multi') {
        setTeams((prev) =>
          prev.map((team) => {
            // Direct match (binary-style keys)
            if (team.key === asset) {
              return { ...team, price, bestBid: bestBid ?? team.bestBid, bestAsk: bestAsk ?? team.bestAsk };
            }
            // Match _yes variant: use price as-is
            if (team.key === `${asset}_yes`) {
              return { ...team, price, bestBid: bestBid ?? team.bestBid, bestAsk: bestAsk ?? team.bestAsk };
            }
            // Match _no variant: invert prices
            if (team.key === `${asset}_no`) {
              const noPrice = 1 - price;
              const noBestBid = bestAsk != null ? 1 - bestAsk : undefined;
              const noBestAsk = bestBid != null ? 1 - bestBid : undefined;
              return { ...team, price: noPrice, bestBid: noBestBid ?? team.bestBid, bestAsk: noBestAsk ?? team.bestAsk };
            }
            return team;
          })
        );
      }
    };
    window.addEventListener('priceUpdate', handlePriceUpdate);
    return () => window.removeEventListener('priceUpdate', handlePriceUpdate);
  }, [marketType]);

  // When user clicks a price in the orderbook, sync selected outcome to that asset
  useEffect(() => {
    const handleOrderbookPriceClick = (event: CustomEvent<{ asset: string }>) => {
      const { asset } = event.detail;
      setActiveOrderbook(asset);
      if (marketType === 'binary') setActiveAsset(asset);
    };
    window.addEventListener('orderbookPriceClick', handleOrderbookPriceClick as EventListener);
    return () => window.removeEventListener('orderbookPriceClick', handleOrderbookPriceClick as EventListener);
  }, [marketType]);

  const handleTeamSelect = (key: string) => {
    setActiveOrderbook(key);
  };

  if (isLoadingMarket || !activeAsset) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0f1115]">
        <Header />
        <div className="flex items-center justify-center h-[80vh]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Loading market...</p>
          </div>
        </div>
      </div>
    );
  }

  // For chart: only Yes outcomes when present; if more than 4 Yes, show top 4 by percentage
  const yesTeams = teams.filter((t) => t.key.endsWith('_yes'));
  const teamsForChart = yesTeams.length > 0 ? yesTeams : teams;
  const chartTeams =
    teamsForChart.length > 4
      ? [...teamsForChart].sort((a, b) => (b.price ?? 0) - (a.price ?? 0)).slice(0, 4)
      : teamsForChart;

  const chartTeam1 = chartTeams[0];
  const chartTeam2 = chartTeams[1];
  const chartTeam3 = chartTeams[2];
  const chartTeam4 = chartTeams[3];

  return (
    <div className="min-h-screen bg-white dark:bg-[#0f1115]">
      <Header />
      <div className="px-4 py-3">
        <div className="max-w-[1800px] mx-auto w-full min-w-0">
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4 min-w-0 w-full">
            <div className="space-y-4 min-w-0 overflow-x-hidden">
              {marketType === 'multi' && chartTeams.length >= 2 ? (
                <LineChart
                  team1={{
                    asset: chartTeam1.key,
                    name: chartTeam1.name,
                    color: '#4A90E2',
                    tokenId: chartTeam1.tokenId,
                  }}
                  team2={{
                    asset: chartTeam2.key,
                    name: chartTeam2.name,
                    color: '#C60C30',
                    tokenId: chartTeam2.tokenId,
                  }}
                  team3={chartTeam3 ? { asset: chartTeam3.key, name: chartTeam3.name, color: '#2E7D32', tokenId: chartTeam3.tokenId } : undefined}
                  team4={chartTeam4 ? { asset: chartTeam4.key, name: chartTeam4.name, color: '#ED6C02', tokenId: chartTeam4.tokenId } : undefined}
                  timeframe="1m"
                  marketTitle={marketTitle}
                  marketImage={marketImage}
                  marketSubtitle={marketSubtitle}
                />
              ) : (
                <CandlestickChart
                  asset={activeAsset}
                  tokenId={teams.find((t) => t.key === activeAsset)?.tokenId}
                  timeframe="1m"
                  onToggle={
                    marketType === 'binary'
                      ? () => setActiveAsset(activeAsset === 'up' ? 'down' : 'up')
                      : undefined
                  }
                  marketTitle={marketTitle}
                  marketImage={marketImage}
                  marketSubtitle={marketSubtitle}
                />
              )}

              {marketType === 'multi' && (
                <TeamSelector
                  teams={teams}
                  activeAsset={activeOrderbook}
                  onTeamSelect={handleTeamSelect}
                  activeTab={activeTab}
                  marketSlug={slug}
                  marketType={marketType}
                />
              )}

              {clobSymbol && <CLOBOrdersAndTrades symbol={clobSymbol} />}
            </div>

            <div className="xl:sticky xl:top-6 xl:self-start">
              <EnhancedTradingPanel
                symbol={clobSymbol}
                marketTitle={marketTitle}
                marketIcon={marketImage}
                upPrice={upPrice}
                downPrice={downPrice}
                selectedOutcome={(marketType === 'multi' ? activeOrderbook : activeAsset) ?? undefined}
                marketType={marketType}
                teams={teams}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
