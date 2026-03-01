'use client';

import { useEffect, useState, useRef } from 'react';
import OrderBookDisplay from './OrderBookDisplay';
import CLOBOrderBook from './CLOBOrderBook';
import { generateCLOBSymbol } from '@/app/lib/clobSymbols';
import { getPolymarketEventUrl, getPolymarketPricesHistoryUrl } from '@/lib/polymarketApi';
import { DEFAULT_WS_URL } from '@/lib/constants';

interface TeamOutcome {
  name: string;
  key: string;
  image?: string;
  probability: number;
  change24h: number;
  volume: number;
  buyYesPrice: number;
  buyNoPrice: number;
  sellYesPrice: number;
  sellNoPrice: number;
  bestBid?: number;
  bestAsk?: number;
}

const WS_URL = DEFAULT_WS_URL;

/** Minimal team shape from parent (market page) for switching books/prices */
export interface ParentTeam {
  name: string;
  key: string;
  price?: number;
  image?: string;
  bestBid?: number;
  bestAsk?: number;
  volume?: number;
  tokenId?: string;
}

export default function TeamSelector({
  teams: teamsProp,
  activeAsset,
  onTeamSelect,
  activeTab = 'buy',
  marketSlug,
  marketType = 'multi'
}: {
  teams?: ParentTeam[];
  activeAsset?: string | null;
  onTeamSelect?: (teamKey: string) => void;
  activeTab?: 'buy' | 'sell';
  marketSlug?: string;
  marketType?: 'binary' | 'multi';
}) {
  const [teams, setTeams] = useState<TeamOutcome[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [marketData, setMarketData] = useState<any>(null);
  const [parentTeamVolumes, setParentTeamVolumes] = useState<Record<string, number>>({});
  const [visibleCount, setVisibleCount] = useState(2);
  const [expandedTeamKey, setExpandedTeamKey] = useState<string | null>(null);

  const useParentTeams = Array.isArray(teamsProp) && teamsProp.length > 0;
  const hasYesNoOutcomes =
    useParentTeams &&
    teamsProp!.length >= 2 &&
    teamsProp!.every((t) => t.key.endsWith('_yes') || t.key.endsWith('_no'));

  // When parent has X_yes / X_no outcomes, aggregate into one row per prefix with yesKey/noKey
  type DisplayTeam = TeamOutcome & { yesKey?: string; noKey?: string };
  function aggregateYesNoTeams(): DisplayTeam[] {
    if (!teamsProp?.length) return [];
    const prefixToOutcomes: Record<string, { yes?: ParentTeam; no?: ParentTeam }> = {};
    for (const t of teamsProp) {
      if (t.key.endsWith('_yes')) {
        const base = t.key.replace(/_yes$/, '');
        if (!prefixToOutcomes[base]) prefixToOutcomes[base] = {};
        prefixToOutcomes[base].yes = t;
      } else if (t.key.endsWith('_no')) {
        const base = t.key.replace(/_no$/, '');
        if (!prefixToOutcomes[base]) prefixToOutcomes[base] = {};
        prefixToOutcomes[base].no = t;
      }
    }
    return Object.entries(prefixToOutcomes).map(([baseKey, { yes, no }]) => {
      const yesKey = yes?.key ?? `${baseKey}_yes`;
      const noKey = no?.key ?? `${baseKey}_no`;
      const displayName =
        yes?.name?.replace(/\s+(Yes|No)$/i, '').trim() ||
        no?.name?.replace(/\s+(Yes|No)$/i, '').trim() ||
        baseKey.replace(/_/g, ' ');
      return {
        name: displayName,
        key: baseKey,
        yesKey,
        noKey,
        image: yes?.image ?? no?.image,
        probability: yes?.price ?? 0,
        change24h: 0,
        volume: parentTeamVolumes[baseKey] ?? 0,
        buyYesPrice: yes?.bestAsk ?? yes?.price ?? 0,
        buyNoPrice: no?.bestAsk ?? no?.price ?? (1 - (yes?.price ?? 0)),
        sellYesPrice: yes?.bestBid ?? yes?.price ?? 0,
        sellNoPrice: no?.bestBid ?? no?.price ?? 0,
        bestBid: yes?.bestBid,
        bestAsk: yes?.bestAsk,
      };
    });
  }

  const displayTeams: DisplayTeam[] = useParentTeams
    ? hasYesNoOutcomes
      ? aggregateYesNoTeams()
      : teamsProp!.map((t) => ({
        name: t.name,
        key: t.key,
        image: t.image,
        probability: t.price ?? 0,
        change24h: 0,
        volume: parentTeamVolumes[t.key] ?? t.volume ?? 0,
        buyYesPrice: t.bestAsk ?? t.price ?? 0,
        buyNoPrice: t.bestBid != null ? 1 - t.bestBid : (1 - (t.price ?? 0)),
        sellYesPrice: t.bestBid ?? t.price ?? 0,
        sellNoPrice: t.bestAsk != null ? 1 - t.bestAsk : (1 - (t.price ?? 0)),
        bestBid: t.bestBid,
        bestAsk: t.bestAsk,
      }))
    : teams;

  // Sort by market percentage (probability / buyYesPrice) descending
  const sortedDisplayTeams = [...displayTeams].sort(
    (a, b) => (b.probability ?? b.buyYesPrice ?? 0) - (a.probability ?? a.buyYesPrice ?? 0)
  );
  const visibleTeams = sortedDisplayTeams.slice(0, visibleCount);
  const hasMore = visibleCount < sortedDisplayTeams.length;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectingRef = useRef(false);
  const initialPricesRef = useRef<Record<string, number>>({});

  // When parent provides teams, no need to fetch; use them for switching books/prices
  useEffect(() => {
    if (useParentTeams) {
      setLoading(false);
      return;
    }
  }, [useParentTeams]);

  // Fetch per-team volume from Polymarket when parent provides teams (so we can show volume)
  useEffect(() => {
    if (!useParentTeams || !marketSlug || !teamsProp?.length) return;

    let cancelled = false;

    const fetchVolumes = async () => {
      try {
        const res = await fetch(getPolymarketEventUrl(marketSlug));
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!data?.markets || cancelled) return;

        const volumesByKey: Record<string, number> = {};
        for (const market of data.markets) {
          const title = market.groupItemTitle || market.question || '';
          const key = title.toLowerCase().replace(/\s+/g, '_');
          const vol = parseFloat(market.volume || '0') || 0;
          if (key) volumesByKey[key] = (volumesByKey[key] ?? 0) + vol;
        }

        if (cancelled) return;
        const hasYesNo = teamsProp.every(
          (t) => t.key.endsWith('_yes') || t.key.endsWith('_no')
        );
        if (hasYesNo && teamsProp.length >= 2) {
          const next: Record<string, number> = {};
          for (const [apiKey, vol] of Object.entries(volumesByKey)) {
            const base = apiKey.replace(/_yes$|_no$/, '');
            if (base) next[base] = (next[base] ?? 0) + vol;
          }
          setParentTeamVolumes(next);
        } else {
          setParentTeamVolumes(volumesByKey);
        }
    } catch (e) {
      if (!cancelled) {
        // Avoid spamming console when backend is not running (e.g. connection refused)
        const isNetworkError =
          e instanceof TypeError && (e.message === 'Failed to fetch' || e.message.includes('fetch'));
        if (!isNetworkError) console.error('Error fetching team volumes:', e);
      }
    }
    };

    fetchVolumes();
    return () => { cancelled = true; };
  }, [useParentTeams, marketSlug, teamsProp?.length]);

  // Fetch market data from Polymarket via our API proxy (only when not using parent teams)
  useEffect(() => {
    if (useParentTeams) return;

    const fetchMarketData = async () => {
      try {
        // Fetch from our API for basic data
        const response = await fetch('/api/markets');
        if (response.ok) {
          const { markets } = await response.json();
          const superBowlMarket = marketSlug
            ? markets.find((m: any) => m.slug === marketSlug)
            : markets[0];

          if (superBowlMarket && superBowlMarket.variant === 'multi') {
            setMarketData(superBowlMarket);

            // Fetch detailed data from Polymarket API via backend proxy (to avoid CORS)
            // Fetch detailed data from Polymarket API (hosted or backend proxy)
            const polymarketResponse = await fetch(
              getPolymarketEventUrl(superBowlMarket.slug ?? marketSlug ?? '')
            );
            let teamVolumes: Record<string, number> = {};
            let priceChanges: Record<string, number> = {};
            let teamTokenIds: Record<string, string> = {};

            if (polymarketResponse.ok) {
              const polymarketData = await polymarketResponse.json();

              // Extract individual market volumes and token IDs
              if (polymarketData.markets && Array.isArray(polymarketData.markets)) {
                polymarketData.markets.forEach((market: any) => {
                  const teamName = market.groupItemTitle || market.question;
                  if (teamName) {
                    const key = teamName.toLowerCase().replace(/\s+/g, '_');
                    teamVolumes[key] = parseFloat(market.volume || '0');

                    // Parse outcome prices to get current price
                    let outcomePrices: string[] = [];
                    if (typeof market.outcomePrices === 'string') {
                      try {
                        outcomePrices = JSON.parse(market.outcomePrices);
                      } catch {
                        outcomePrices = [];
                      }
                    } else if (Array.isArray(market.outcomePrices)) {
                      outcomePrices = market.outcomePrices;
                    }

                    // Get token IDs for fetching price history
                    let clobTokenIds: string[] = [];
                    if (typeof market.clobTokenIds === 'string') {
                      try {
                        clobTokenIds = JSON.parse(market.clobTokenIds);
                      } catch {
                        clobTokenIds = [];
                      }
                    } else if (Array.isArray(market.clobTokenIds)) {
                      clobTokenIds = market.clobTokenIds;
                    }

                    if (clobTokenIds[0]) {
                      teamTokenIds[key] = clobTokenIds[0]; // Yes token ID
                    }
                  }
                });
              }

              // Fetch price history for each team to calculate 24h change
              const priceHistoryPromises = Object.entries(teamTokenIds).map(async ([key, tokenId]) => {
                try {
                  // Fetch last 24 hours of price data via backend proxy
                  const now = Date.now();
                  const oneDayAgo = now - 24 * 60 * 60 * 1000;

                  const priceHistoryResponse = await fetch(
                    getPolymarketPricesHistoryUrl(tokenId, 'max', 60)
                  );

                  if (priceHistoryResponse.ok) {
                    const priceHistory = await priceHistoryResponse.json();

                    if (priceHistory.history && priceHistory.history.length > 0) {
                      // Get current price (most recent)
                      const currentPrice = parseFloat(priceHistory.history[priceHistory.history.length - 1].p);

                      // Find price from ~24 hours ago
                      let price24hAgo = currentPrice;
                      for (const point of priceHistory.history) {
                        if (point.t * 1000 <= oneDayAgo) {
                          price24hAgo = parseFloat(point.p);
                        } else {
                          break;
                        }
                      }

                      // Calculate percentage change
                      if (price24hAgo > 0) {
                        const change = ((currentPrice - price24hAgo) / price24hAgo) * 100;
                        priceChanges[key] = change;
                      }
                    }
                  }
                } catch (error) {
                  const isNetworkError =
                    error instanceof TypeError && ((error as Error).message === 'Failed to fetch' || (error as Error).message?.includes('fetch'));
                  if (!isNetworkError) console.error(`Error fetching price history for ${key}:`, error);
                }
              });

              await Promise.all(priceHistoryPromises);
            }

            // Initialize teams with data from API
            const initialTeams: TeamOutcome[] = superBowlMarket.outcomes.map((outcome: any) => {
              const key = outcome.label.toLowerCase().replace(/\s+/g, '_');
              const probability = outcome.percent / 100;

              // Store initial price for change calculation
              initialPricesRef.current[key] = probability;

              // Get actual volume and price change from Polymarket
              const teamVolume = teamVolumes[key] || 0;
              const change24h = priceChanges[key] || 0;

              return {
                name: outcome.label,
                key: key,
                image: outcome.image,
                probability: probability,
                change24h: change24h,
                volume: teamVolume,
                buyYesPrice: probability,
                buyNoPrice: 1 - probability,
                sellYesPrice: probability,
                sellNoPrice: 1 - probability
              };
            });

            setTeams(initialTeams);
            setLoading(false);
          }
        }
      } catch (error) {
        const isNetworkError =
          error instanceof TypeError && ((error as Error).message === 'Failed to fetch' || (error as Error).message?.includes('fetch'));
        if (!isNetworkError) console.error('Error fetching market data:', error);
        setLoading(false);
      }
    };

    fetchMarketData();

    // Refresh market data every 30 seconds
    const interval = setInterval(fetchMarketData, 30000);
    return () => clearInterval(interval);
  }, []);

  // Process server message from WebSocket
  const processServerMessage = (message: any) => {
    if (message.type === 'connected') {
      return;
    }

    if (message.type === 'orderbook_update') {
      const { outcome, bids, asks } = message;

      // Calculate best prices
      const bestBid = bids[0]?.price || 0;
      const bestAsk = asks[0]?.price || 0;
      const currentPrice = (bestBid + bestAsk) / 2 || bestBid || bestAsk;

      // Update team data with real-time prices
      setTeams(prevTeams =>
        prevTeams.map(team => {
          if (team.key === outcome) {
            return {
              ...team,
              probability: currentPrice,
              buyYesPrice: bestAsk > 0 ? bestAsk : currentPrice,
              buyNoPrice: bestBid > 0 ? (1 - bestBid) : (1 - currentPrice),
              sellYesPrice: bestBid > 0 ? bestBid : currentPrice,
              sellNoPrice: bestAsk > 0 ? (1 - bestAsk) : (1 - currentPrice),
              bestBid,
              bestAsk,
              // Keep existing volume and 24h change from initial fetch
            };
          }
          return team;
        })
      );

      // Emit price update event for TradingPanel
      const priceEvent = new CustomEvent('priceUpdate', {
        detail: { asset: outcome, price: currentPrice }
      });
      window.dispatchEvent(priceEvent);
    }
  };

  // Connect to WebSocket
  const connectWebSocket = () => {
    if (!WS_URL || reconnectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    reconnectingRef.current = true;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectingRef.current = false;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          processServerMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        setIsConnected(false);
        reconnectingRef.current = false;
      };

      ws.onclose = () => {
        setIsConnected(false);
        reconnectingRef.current = false;

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 3000);
      };
    } catch (error) {
      setIsConnected(false);
      reconnectingRef.current = false;
    }
  };

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

  const formatVolume = (volume: number) => {
    return `$${Math.round(volume).toLocaleString('en-US')}`;
  };

  const formatCents = (price: number) => {
    return `${(price * 100).toFixed(2)}c`;
  };

  const handleTeamClick = (teamKey: string) => {
    // Emit team selection event for TradingPanel
    const teamSelectEvent = new CustomEvent('teamSelected', {
      detail: { teamKey }
    });
    window.dispatchEvent(teamSelectEvent);

    // Also call the callback if provided
    if (onTeamSelect) {
      onTeamSelect(teamKey);
    }
  };

  const toggleTeamExpand = (teamKey: string) => {
    setExpandedTeamKey((prev) => (prev === teamKey ? null : teamKey));
  };

  if (loading && !useParentTeams) {
    return (
      <div className="w-full bg-white dark:bg-[#0c111a] rounded-xl overflow-hidden">
        {/* Skeleton Loading */}
        {[1, 2].map((i) => (
          <div key={i} className="px-5 py-2.5 border-b border-gray-200 dark:border-[#1a2332] animate-pulse">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gray-200 dark:bg-[#1a2332] rounded-lg" />
                <div>
                  <div className="h-3.5 w-20 bg-gray-200 dark:bg-[#1a2332] rounded mb-1.5" />
                  <div className="h-2.5 w-24 bg-gray-200 dark:bg-[#1a2332] rounded" />
                </div>
              </div>
              <div className="flex items-center gap-5">
                <div className="h-6 w-12 bg-gray-200 dark:bg-[#1a2332] rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 bg-white dark:bg-[#0c111a] rounded-xl overflow-hidden border border-gray-200 dark:border-[#1a2332]">
      {visibleTeams.map((team, index) => {
        const yesKey = team.yesKey ?? team.key;
        const noKey = team.noKey ?? team.key;
        const isYesActive = activeAsset != null && activeAsset === yesKey;
        const isNoActive = activeAsset != null && activeAsset === noKey;
        const isExpanded = expandedTeamKey === team.key;
        // Use selected outcome (yes/no) for this team when generating CLOB symbol and showing orderbooks
        const outcomeForThisTeam = activeAsset === yesKey || activeAsset === noKey ? activeAsset : yesKey;
        const clobSymbol = marketSlug ? generateCLOBSymbol(marketSlug, marketType, outcomeForThisTeam) : '';
        return (
          <div
            key={team.key}
            className={`transition-colors ${index < visibleTeams.length - 1 || hasMore ? 'border-b border-gray-200 dark:border-[#1a2332]' : ''}`}
          >
            <div
              className={`flex items-center justify-between px-5 py-2.5 hover:bg-gray-50 dark:hover:bg-[#0f1520] cursor-pointer ${isExpanded ? 'bg-gray-50 dark:bg-[#0f1520]' : ''}`}
              onClick={() => toggleTeamExpand(team.key)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleTeamExpand(team.key);
                }
              }}
              aria-expanded={isExpanded}
            >
              {/* Left: Team Info + expand chevron */}
              <div className="flex items-center gap-3">
                <div
                  className={`w-6 h-6 flex items-center justify-center shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  aria-hidden
                >
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <div className="w-9 h-9 bg-blue-50 dark:bg-[#1a2d4d] rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                  {team.image ? (
                    <img
                      src={team.image}
                      alt={team.name}
                      className="w-7 h-7 object-contain"
                    />
                  ) : (
                    <span className="text-gray-900 dark:text-white font-bold text-sm">
                      {team.name.substring(0, 3).toUpperCase()}
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="text-gray-900 dark:text-white font-semibold text-base">{team.name}</h3>
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <span>{formatVolume(team.volume)} Vol.</span>
                  </div>
                </div>
              </div>

              {/* Right: Probability & Buy Yes / Buy No buttons */}
              <div className="flex items-center gap-5" onClick={(e) => e.stopPropagation()}>
                <div className="text-center">
                  <div className="text-xl font-bold text-gray-900 dark:text-white">
                    {(team.probability * 100).toFixed(2)}%
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      handleTeamClick(yesKey);
                      setExpandedTeamKey(team.key);
                    }}
                    className={`px-4 py-1.5 rounded-lg font-semibold transition-colors min-w-[100px] ${isYesActive ? 'ring-2 ring-white ring-offset-2 ring-offset-white dark:ring-offset-[#0c111a]' : ''} ${activeTab === 'buy' ? 'bg-[#15803d] hover:bg-[#16a34a] text-white' : 'bg-[#15803d] hover:bg-[#16a34a] text-white'}`}
                  >
                    <div className="text-[10px] opacity-80">{activeTab === 'buy' ? 'Buy Yes' : 'Sell Yes'}</div>
                    <div className="text-sm">
                      {formatCents(activeTab === 'buy' ? team.buyYesPrice : team.sellYesPrice)}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleTeamClick(noKey);
                      setExpandedTeamKey(team.key);
                    }}
                    className={`px-4 py-1.5 rounded-lg font-semibold transition-colors min-w-[100px] ${isNoActive ? 'ring-2 ring-white ring-offset-2 ring-offset-white dark:ring-offset-[#0c111a]' : ''} ${activeTab === 'buy' ? 'bg-[#991b1b] hover:bg-[#dc2626] text-white' : 'bg-[#991b1b] hover:bg-[#dc2626] text-white'}`}
                  >
                    <div className="text-[10px] opacity-80">{activeTab === 'buy' ? 'Buy No' : 'Sell No'}</div>
                    <div className="text-sm">
                      {(() => {
                        if (sortedDisplayTeams.length === 2 && !hasYesNoOutcomes && activeTab === 'buy') {
                          const otherTeam = sortedDisplayTeams.find((t) => t.key !== team.key);
                          if (otherTeam && otherTeam.bestAsk) {
                            return formatCents(otherTeam.bestAsk);
                          }
                        }
                        return formatCents(activeTab === 'buy' ? team.buyNoPrice : team.sellNoPrice);
                      })()}
                    </div>
                  </button>
                </div>
              </div>
            </div>

            {/* Expanded: Orderbooks for this team */}
            {isExpanded && (
              <div className="px-2 pb-2 pt-1 bg-gray-50 dark:bg-[#0a0e14] border-t border-gray-200 dark:border-[#1a2332] max-h-[min(360px,50vh)] max-w-[50%] overflow-y-auto overflow-x-hidden min-w-0">
                <div className="min-w-0">
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-[#8b94a3] mb-2 px-1">
                    Derive Orderbook — {team.name}
                  </h4>
                  {clobSymbol ? (
                    <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-[#1a2332]">
                      <CLOBOrderBook symbol={clobSymbol} autoInitialize={false} />
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-xl p-6 text-center">
                      <div className="text-sm text-gray-500 dark:text-[#8b94a3]">Select a market to load orderbook.</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {hasMore && (
        <button
          type="button"
          onClick={() => setVisibleCount(sortedDisplayTeams.length)}
          className="w-full px-5 py-2 flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-[#0f1520] transition-colors border-t border-gray-200 dark:border-[#1a2332]"
        >
          <span>Show all</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}
    </div>
  );
}
