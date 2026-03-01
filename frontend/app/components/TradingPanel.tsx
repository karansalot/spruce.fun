'use client';

import { useState, useEffect } from 'react';

interface TeamOutcome {
  name: string;
  key: string;
  price: number;
  bestBid?: number;
  bestAsk?: number;
  image?: string;
}

interface TradingPanelProps {
  upPrice?: number;
  downPrice?: number;
  selectedOutcome?: 'up' | 'down' | string;
  onOutcomeChange?: (outcome: 'up' | 'down' | string) => void;
  marketType?: 'binary' | 'multi';
  teams?: TeamOutcome[];
  activeTab?: 'buy' | 'sell';
  onTabChange?: (tab: 'buy' | 'sell') => void;
}

export default function TradingPanel({
  upPrice = 0,
  downPrice = 0,
  selectedOutcome: propSelectedOutcome,
  onOutcomeChange,
  marketType = 'binary',
  teams = [],
  activeTab: propActiveTab,
  onTabChange
}: TradingPanelProps) {
  const [internalActiveTab, setInternalActiveTab] = useState<'buy' | 'sell'>('buy');

  const activeTab = propActiveTab !== undefined ? propActiveTab : internalActiveTab;

  const handleTabChange = (tab: 'buy' | 'sell') => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalActiveTab(tab);
    }
  };

  const [internalSelectedOutcome, setInternalSelectedOutcome] = useState<string>('up');
  const [selectedTeam, setSelectedTeam] = useState<string>(
    propSelectedOutcome && propSelectedOutcome !== 'up' && propSelectedOutcome !== 'down'
      ? propSelectedOutcome
      : (teams.length > 0 ? teams[0].key : 'up')
  );
  const [yesNoSelection, setYesNoSelection] = useState<'yes' | 'no'>('yes');

  // Sync selectedTeam with propSelectedOutcome
  useEffect(() => {
    if (propSelectedOutcome && propSelectedOutcome !== 'up' && propSelectedOutcome !== 'down') {
      setSelectedTeam(propSelectedOutcome);
    }
  }, [propSelectedOutcome]);

  // Listen for team selection from TeamSelector — only switch the selected button, do not change internal prices
  useEffect(() => {
    const handleTeamSelected = (event: any) => {
      const { teamKey } = event.detail;
      setSelectedTeam(teamKey);
      // Sync Yes/No button to match the clicked button (e.g. seattle_yes → Yes, seattle_no → No)
      if (teamKey.endsWith('_yes')) {
        setYesNoSelection('yes');
      } else if (teamKey.endsWith('_no')) {
        setYesNoSelection('no');
      }
      if (onOutcomeChange) {
        onOutcomeChange(teamKey);
      } else {
        setInternalSelectedOutcome(teamKey);
      }
    };

    window.addEventListener('teamSelected', handleTeamSelected);
    return () => window.removeEventListener('teamSelected', handleTeamSelected);
  }, [onOutcomeChange]);

  const selectedOutcome = propSelectedOutcome !== undefined ? propSelectedOutcome : internalSelectedOutcome;

  const handleOutcomeChange = (outcome: string) => {
    if (onOutcomeChange) {
      onOutcomeChange(outcome);
    } else {
      setInternalSelectedOutcome(outcome);
    }
  };

  const handleTeamSelect = (teamKey: string) => {
    setSelectedTeam(teamKey);
    handleOutcomeChange(teamKey);
  };

  // Derive team abbreviation from key/name (e.g. new_england -> NE, seattle -> SEA)
  const getTeamAbbr = (nameOrKey: string) => {
    const k = nameOrKey.replace(/_yes$|_no$/, '').trim();
    const parts = k.split('_').filter(Boolean);
    if (parts.length >= 2)
      return parts.map((p) => p[0]).join('').toUpperCase().substring(0, 3);
    return k.substring(0, 3).toUpperCase() || 'OUT';
  };

  // For 4-outcome markets (seattle_yes, seattle_no, ...): derive team base so Yes/No buttons
  // always show the correct outcome price and don't swap when selection changes.
  const teamBase = (selectedTeam.endsWith('_yes') || selectedTeam.endsWith('_no'))
    ? selectedTeam.replace(/_yes$|_no$/, '')
    : selectedTeam;
  const hasYesNoOutcomes = teams.some(t => t.key.endsWith('_yes') || t.key.endsWith('_no'));
  const yesOutcome = hasYesNoOutcomes ? teams.find(t => t.key === `${teamBase}_yes`) : teams.find(t => t.key === selectedTeam);
  const noOutcome = hasYesNoOutcomes ? teams.find(t => t.key === `${teamBase}_no`) : teams.find(t => t.key !== selectedTeam);
  const displayTeam = teams.find(t => t.key === selectedTeam) || yesOutcome || noOutcome || teams[0];

  const [limitPrice, setLimitPrice] = useState<string>('010');
  const [shares, setShares] = useState<string>('500');
  const [total, setTotal] = useState<number>(0);
  const [toWin, setToWin] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showShine, setShowShine] = useState(true);
  const isLoading = marketType === 'binary'
    ? (upPrice <= 0 && downPrice <= 0)
    : (teams.length === 0 || teams.every(t => t.price <= 0));

  // Calculate total and to win
  useEffect(() => {
    const priceValue = parseInt(limitPrice) / 100; // Convert cents to dollars
    const sharesValue = parseInt(shares) || 0;

    if (activeTab === 'buy') {
      const totalCost = priceValue * sharesValue;
      setTotal(totalCost);
      setToWin(sharesValue); // Winning shares
    } else {
      // For sell
      const totalValue = priceValue * sharesValue;
      setTotal(totalValue);
      setToWin(sharesValue);
    }
  }, [limitPrice, shares, activeTab]);

  useEffect(() => {
    const timer = setTimeout(() => setShowShine(false), 1300);
    return () => clearTimeout(timer);
  }, []);

  const handleMultiplier = (multiplier: number) => {
    const currentShares = parseInt(shares) || 0;
    setShares((currentShares * multiplier).toString());
  };

  const incrementPrice = () => {
    const current = parseInt(limitPrice);
    if (current < 100) {
      setLimitPrice((current + 1).toString().padStart(3, '0'));
    }
  };

  const decrementPrice = () => {
    const current = parseInt(limitPrice);
    if (current > 1) {
      setLimitPrice((current - 1).toString().padStart(3, '0'));
    }
  };

  const formatCents = (price: number) => {
    return `${(price * 100).toFixed(2)}¢`;
  };

  const handleSubmit = async () => {
    setIsProcessing(true);

    try {
      const order = {
        id: `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: activeTab,
        outcome: marketType === 'multi' ? selectedTeam : selectedOutcome,
        yesNo: marketType === 'multi' ? yesNoSelection : undefined,
        limitPrice: parseInt(limitPrice) / 100,
        shares: parseInt(shares),
        total: total,
        status: 'open' as const,
        timestamp: Date.now(),
      };

      // Dispatch event for MyOrders component
      const event = new CustomEvent('newOrder', { detail: order });
      window.dispatchEvent(event);

    } catch (error: any) {
      console.error('Order submission error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className={`w-[360px] bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.35)] ${showShine ? 'shine-once' : ''}`}>
      <div className={isLoading ? 'opacity-0 pointer-events-none' : 'opacity-100'}>
        {/* BUY/SELL Tabs - Common for all market types */}
        <div className="grid grid-cols-2 gap-0 px-4 pt-4 border-b border-gray-200 dark:border-[#1f2430]">
          <button
            onClick={() => handleTabChange('buy')}
            className={`py-3 text-sm font-semibold transition-colors border-b-2 ${activeTab === 'buy'
              ? 'text-[#3a7bff] border-[#3a7bff]'
              : 'text-gray-500 dark:text-[#7d8795] border-transparent hover:text-gray-900 dark:hover:text-white'
              }`}
          >
            BUY
          </button>
          <button
            onClick={() => handleTabChange('sell')}
            className={`py-3 text-sm font-semibold transition-colors border-b-2 ${activeTab === 'sell'
              ? 'text-[#ef4444] border-[#ef4444]'
              : 'text-gray-500 dark:text-[#7d8795] border-transparent hover:text-gray-900 dark:hover:text-white'
              }`}
          >
            SELL
          </button>
        </div>

        {/* Market Title and Team Selection */}
        <div className="px-5 py-4 space-y-4">
          {marketType === 'multi' && teams.length > 0 ? (
            /* Multi-Team Market */
            <>
              {/* Market Title */}
              <div className="flex items-center gap-3">
                {displayTeam?.image && (
                  <img
                    src={displayTeam.image}
                    alt={displayTeam.name}
                    className="w-10 h-10 rounded-lg"
                  />
                )}
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                    {displayTeam?.name || teams[0]?.name}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-[#8b94a3]">
                    {activeTab === 'buy' ? 'Buy' : 'Sell'} {yesNoSelection === 'yes' ? 'Yes' : 'No'}
                  </p>
                </div>
              </div>

              {/* Yes/No Selection: always show Yes outcome price on Yes button, No outcome price on No button */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setYesNoSelection('yes');
                    if (yesOutcome?.key) {
                      setSelectedTeam(yesOutcome.key);
                      if (onOutcomeChange) onOutcomeChange(yesOutcome.key);
                      else setInternalSelectedOutcome(yesOutcome.key);
                    }
                  }}
                  className={`py-3 px-4 rounded-xl font-semibold text-sm transition-all ${yesNoSelection === 'yes'
                    ? 'bg-[#22c55e] text-white shadow-lg shadow-green-500/25'
                    : 'bg-gray-50 dark:bg-[#0f131a] text-gray-500 dark:text-[#8b94a3] hover:bg-gray-100 dark:hover:bg-[#1a1f28]'
                    }`}
                >
                  Yes {(() => {
                    const team = yesOutcome;
                    if (!team) return '...';
                    const price = activeTab === 'buy'
                      ? (team.bestAsk || team.price)
                      : (team.bestBid || team.price);
                    return price > 0 ? formatCents(price) : '...';
                  })()}
                </button>
                <button
                  onClick={() => {
                    setYesNoSelection('no');
                    if (noOutcome?.key) {
                      setSelectedTeam(noOutcome.key);
                      if (onOutcomeChange) onOutcomeChange(noOutcome.key);
                      else setInternalSelectedOutcome(noOutcome.key);
                    }
                  }}
                  className={`py-3 px-4 rounded-xl font-semibold text-sm transition-all ${yesNoSelection === 'no'
                    ? 'bg-[#ED2C2C] text-white shadow-lg shadow-red-500/30'
                    : 'bg-gray-50 dark:bg-[#0f131a] text-gray-500 dark:text-[#8b94a3] hover:bg-gray-100 dark:hover:bg-[#1a1f28]'
                    }`}
                >
                  No {(() => {
                    if (!noOutcome) return '...';
                    // 4-outcome: show No outcome's own price (bestAsk for buy, bestBid for sell)
                    if (hasYesNoOutcomes) {
                      const price = activeTab === 'buy'
                        ? (noOutcome.bestAsk ?? noOutcome.price)
                        : (noOutcome.bestBid ?? noOutcome.price);
                      return price > 0 ? formatCents(price) : '...';
                    }
                    // 2-outcome: "Buy No A" = opponent's ask
                    if (teams.length === 2 && activeTab === 'buy' && noOutcome.bestAsk && noOutcome.bestAsk > 0) {
                      return formatCents(noOutcome.bestAsk);
                    }
                    const price = activeTab === 'buy'
                      ? (1 - (noOutcome.bestBid ?? noOutcome.price))
                      : (1 - (noOutcome.bestAsk ?? noOutcome.price));
                    return price > 0 ? formatCents(price) : '...';
                  })()}
                </button>
              </div>
            </>
          ) : (
            /* Binary Up/Down Market */
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleOutcomeChange('up')}
                className={`py-3 px-4 rounded-xl font-semibold text-sm transition-all ${selectedOutcome === 'up'
                  ? 'bg-[#22c55e] text-white shadow-lg shadow-green-500/25'
                  : 'bg-gray-50 dark:bg-[#0f131a] text-gray-500 dark:text-[#8b94a3] hover:bg-gray-100 dark:hover:bg-[#1a1f28]'
                  }`}
              >
                Up {upPrice > 0 ? formatCents(upPrice) : '...'}
              </button>
              <button
                onClick={() => handleOutcomeChange('down')}
                className={`py-3 px-4 rounded-xl font-semibold text-sm transition-all ${selectedOutcome === 'down'
                  ? 'bg-[#ED2C2C] text-white shadow-lg shadow-red-500/30'
                  : 'bg-gray-50 dark:bg-[#0f131a] text-gray-500 dark:text-[#8b94a3] hover:bg-gray-100 dark:hover:bg-[#1a1f28]'
                  }`}
              >
                Down {downPrice > 0 ? formatCents(downPrice) : '...'}
              </button>
            </div>
          )}
        </div>

        {/* Common Form Fields */}
        <div className="px-5 py-4 space-y-4 border-t border-gray-200 dark:border-[#1f2430]">
          {/* Limit Price */}
          <div>
            <label className="text-xs text-gray-500 dark:text-[#8b94a3] mb-2 block">Limit Price (¢)</label>
            <div className="flex items-center gap-2">
              <button
                onClick={decrementPrice}
                className="w-10 h-10 bg-gray-50 dark:bg-[#0f131a] hover:bg-gray-100 dark:hover:bg-[#1a1f28] text-gray-900 dark:text-white rounded-lg flex items-center justify-center transition-colors border border-gray-200 dark:border-[#1f2430]"
              >
                <span className="text-xl font-bold">−</span>
              </button>
              <input
                type="text"
                value={limitPrice}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '');
                  if (value === '' || (parseInt(value) >= 0 && parseInt(value) <= 100)) {
                    setLimitPrice(value.padStart(3, '0'));
                  }
                }}
                className="flex-1 bg-gray-50 dark:bg-[#0f131a] border border-gray-200 dark:border-[#1f2430] rounded-lg px-4 py-2 text-center text-gray-900 dark:text-white font-mono text-lg focus:outline-none focus:border-[#3a7bff]"
              />
              <button
                onClick={incrementPrice}
                className="w-10 h-10 bg-gray-50 dark:bg-[#0f131a] hover:bg-gray-100 dark:hover:bg-[#1a1f28] text-gray-900 dark:text-white rounded-lg flex items-center justify-center transition-colors border border-gray-200 dark:border-[#1f2430]"
              >
                <span className="text-xl font-bold">+</span>
              </button>
            </div>
          </div>

          {/* Shares */}
          <div>
            <label className="text-xs text-gray-500 dark:text-[#8b94a3] mb-2 block">Shares</label>
            <input
              type="text"
              value={shares}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '');
                setShares(value);
              }}
              className="w-full bg-gray-50 dark:bg-[#0f131a] border border-gray-200 dark:border-[#1f2430] rounded-lg px-4 py-2 text-center text-gray-900 dark:text-white font-mono focus:outline-none focus:border-[#3a7bff]"
            />

            {/* Multipliers */}
            <div className="grid grid-cols-3 gap-2 mt-2">
              <button
                onClick={() => handleMultiplier(2)}
                className="py-1.5 bg-gray-50 dark:bg-[#0f131a] hover:bg-gray-100 dark:hover:bg-[#1a1f28] text-gray-900 dark:text-white text-sm font-semibold rounded-lg transition-colors border border-gray-200 dark:border-[#1f2430]"
              >
                2x
              </button>
              <button
                onClick={() => handleMultiplier(5)}
                className="py-1.5 bg-gray-50 dark:bg-[#0f131a] hover:bg-gray-100 dark:hover:bg-[#1a1f28] text-gray-900 dark:text-white text-sm font-semibold rounded-lg transition-colors border border-gray-200 dark:border-[#1f2430]"
              >
                5x
              </button>
              <button
                onClick={() => handleMultiplier(10)}
                className="py-1.5 bg-gray-50 dark:bg-[#0f131a] hover:bg-gray-100 dark:hover:bg-[#1a1f28] text-gray-900 dark:text-white text-sm font-semibold rounded-lg transition-colors border border-gray-200 dark:border-[#1f2430]"
              >
                10x
              </button>
            </div>
          </div>

          {/* Summary */}
          <div className="pt-2 border-t border-gray-200 dark:border-[#1f2430]">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-[#8b94a3]">Total</span>
              <span className="text-lg font-bold text-gray-900 dark:text-white">${total.toFixed(2)}</span>
            </div>
          </div>

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={!shares || parseInt(shares) === 0 || isProcessing}
            className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'buy'
              ? 'bg-[#3a7bff] hover:bg-[#4b88ff] text-white shadow-lg shadow-blue-500/30'
              : 'bg-[#ef4444] hover:bg-[#f05a5a] text-white shadow-lg shadow-red-500/30'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isProcessing
              ? 'Processing...'
              : (() => {
                if (marketType === 'multi') {
                  const teamName = teams.find(t => t.key === selectedTeam)?.name || selectedOutcome;
                  const yesNo = yesNoSelection === 'yes' ? 'Yes' : 'No';
                  return activeTab === 'buy' ? `Buy ${yesNo}` : `Sell ${yesNo}`;
                } else {
                  const teamName = selectedOutcome === 'up' ? 'Up' : 'Down';
                  return activeTab === 'buy' ? `Buy ` : `Sell`;
                }
              })()
            }
          </button>
        </div>
      </div>
    </div>
  );
}
