'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  CandlestickSeriesPartialOptions,
  HistogramSeriesPartialOptions,
  LineSeriesPartialOptions,
  Time
} from 'lightweight-charts';
import { getPolymarketPricesHistoryUrl } from '@/lib/polymarketApi';
import { DEFAULT_API_URL, DEFAULT_WS_URL } from '@/lib/constants';

const CHART_THEMES = {
  dark: {
    layout: { background: { type: ColorType.Solid, color: '#12161c' }, textColor: '#8b94a3' },
    grid: { vertLines: { color: '#1b202a' }, horzLines: { color: '#1b202a' } },
    timeScale: { borderColor: '#1b202a' },
    rightPriceScale: { borderColor: '#1b202a' },
    crosshair: {
      vertLine: { color: '#666', width: 1 as const, style: 1 as const, labelBackgroundColor: '#1f2430' },
      horzLine: { color: '#666', width: 1 as const, style: 1 as const, labelBackgroundColor: '#1f2430' },
    },
  },
  light: {
    layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#6b7280' },
    grid: { vertLines: { color: '#f3f4f6' }, horzLines: { color: '#f3f4f6' } },
    timeScale: { borderColor: '#e5e7eb' },
    rightPriceScale: { borderColor: '#e5e7eb' },
    crosshair: {
      vertLine: { color: '#9ca3af', width: 1 as const, style: 1 as const, labelBackgroundColor: '#f3f4f6' },
      horzLine: { color: '#9ca3af', width: 1 as const, style: 1 as const, labelBackgroundColor: '#f3f4f6' },
    },
  },
} as const;

interface CandlestickChartProps {
  asset: string;
  /** Optional CLOB token ID; when set, chart fetches from Polymarket getPricesHistory. */
  tokenId?: string;
  timeframe?: '1m' | '1h' | '6h' | '1d' | '1w' | 'max';
  wsUrl?: string;
  apiUrl?: string;
  onToggle?: () => void;
  marketTitle?: string;
  marketImage?: string;
  marketSubtitle?: string;
}

interface CandleData {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  color?: string;
  borderColor?: string;
  wickColor?: string;
}

/** Normalize API time to Unix seconds. API may send seconds or milliseconds. */
const normalizeTime = (time: Time | number | string): Time => {
  const numeric = Number(time);
  if (!Number.isFinite(numeric)) {
    return time as Time;
  }
  if (numeric > 2e10) {
    return Math.floor(numeric / 1000) as Time;
  }
  return numeric as Time;
};

/** Format Unix timestamp (seconds) for x-axis. Uses safe locale and includes time to avoid duplicate labels. */
const formatTimeLabel = (tsSeconds: number, timeframe: string, locale: string | undefined) => {
  if (!Number.isFinite(tsSeconds)) return '–';
  const safeLocale = (typeof locale === 'string' && locale) ? locale : 'en-US';
  const date = new Date(tsSeconds * 1000);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
  if (timeframe === '1m') {
    return date.toLocaleDateString(safeLocale, { ...opts, year: 'numeric' })
      + ', ' + date.toLocaleTimeString(safeLocale, timeOpts);
  }
  if (timeframe === '1h' || timeframe === '6h') {
    return date.toLocaleTimeString(safeLocale, timeOpts) + ' ' + date.toLocaleDateString(safeLocale, opts);
  }
  if (timeframe === 'max') {
    return date.toLocaleDateString(safeLocale, { ...opts, year: 'numeric' })
      + ', ' + date.toLocaleTimeString(safeLocale, timeOpts);
  }
  return date.toLocaleDateString(safeLocale, opts)
    + ', ' + date.toLocaleTimeString(safeLocale, timeOpts);
};

const calculateHeikinAshi = (data: CandleData[], useRawPrevOpenClose = false): CandleData[] => {
  if (data.length === 0) return [];

  const result: CandleData[] = [];

  // First candle
  const first = data[0];
  let haOpen = (first.open + first.close) / 2;
  let haClose = (first.open + first.high + first.low + first.close) / 4;

  result.push({
    time: first.time,
    open: haOpen,
    high: Math.max(first.high, haOpen, haClose),
    low: Math.min(first.low, haOpen, haClose),
    close: haClose,
    volume: first.volume,
    color: first.color,
    borderColor: first.borderColor,
    wickColor: first.wickColor
  });

  for (let i = 1; i < data.length; i++) {
    const curr = data[i];
    const prev = useRawPrevOpenClose ? data[i - 1] : result[i - 1];

    haOpen = (prev.open + prev.close) / 2;
    haClose = (curr.open + curr.high + curr.low + curr.close) / 4;

    result.push({
      time: curr.time,
      open: haOpen,
      high: Math.max(curr.high, haOpen, haClose),
      low: Math.min(curr.low, haOpen, haClose),
      close: haClose,
      volume: curr.volume,
      color: curr.color,
      borderColor: curr.borderColor,
      wickColor: curr.wickColor
    });
  }

  return result;
};

const TIMEFRAME_SECONDS: Record<string, number> = {
  '1m': 30 * 86400, // 1 month ≈ 30 days
  '1h': 3600,
  '6h': 21600,
  '1d': 86400,
  '1w': 604800,
};

const fillDataGaps = (data: CandleData[], timeframe: string): CandleData[] => {
  if (data.length < 2) return data;

  const interval = TIMEFRAME_SECONDS[timeframe];
  if (!interval) {
    return data;
  }

  const filledData: CandleData[] = [];
  const sortedData = [...data].sort((a, b) => (a.time as number) - (b.time as number));

  filledData.push(sortedData[0]);

  let gapsFilled = 0;

  for (let i = 1; i < sortedData.length; i++) {
    const prev = sortedData[i - 1];
    const curr = sortedData[i];
    const prevTime = prev.time as number;
    const currTime = curr.time as number;

    if (currTime - prevTime > interval) {
      let nextTime = prevTime + interval;
      // Safety check to prevent infinite loops if data is weird
      const maxFill = 10000;
      let fillCount = 0;

      while (nextTime < currTime && fillCount < maxFill) {
        const fillerColor = prev.close >= prev.open ? '#22c55e' : '#ef4444';
        filledData.push({
          time: nextTime as Time,
          open: prev.close,
          high: prev.close,
          low: prev.close,
          close: prev.close,
          volume: 0,
          color: fillerColor,
          borderColor: fillerColor,
          wickColor: fillerColor
        });
        nextTime += interval;
        fillCount++;
        gapsFilled++;
      }
    }
    filledData.push(curr);
  }


  return filledData;
};

// Use hosted backend URLs (default: perpmarket-production)
const getDefaultWsUrl = () => DEFAULT_WS_URL;
const getDefaultApiUrl = () => DEFAULT_API_URL;

export default function CandlestickChart({
  asset,
  tokenId,
  timeframe = '1m',
  wsUrl = getDefaultWsUrl(),
  apiUrl = getDefaultApiUrl(),
  onToggle,
  marketTitle: propMarketTitle,
  marketImage: propMarketImage,
  marketSubtitle: propMarketSubtitle
}: CandlestickChartProps) {
  const { resolvedTheme } = useTheme();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const ma7SeriesRef = useRef<any>(null);
  const ma25SeriesRef = useRef<any>(null);
  // const ma99SeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const initialZoomAppliedRef = useRef(false);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candleData, setCandleData] = useState<CandleData[]>([]);
  const [currentTimeframe, setCurrentTimeframe] = useState(timeframe);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [wsMarketTitle, setWsMarketTitle] = useState<string>("");
  const [wsMarketImage, setWsMarketImage] = useState<string>("");
  const showSkeleton = isLoading && !error && candleData.length === 0;

  // Use prop values if provided, otherwise fall back to WebSocket values
  const marketTitle = propMarketTitle || wsMarketTitle;
  const marketImage = propMarketImage || wsMarketImage;
  const timeframes = ['1h', '6h', '1d', '1w', '1m', 'max'] as const;
  const timeframeButtonWidth = 52;
  const timeframeButtonHeight = 30;
  const activeTimeframeIndex = Math.max(0, timeframes.indexOf(currentTimeframe));

  const handleToggle = () => {
    if (!onToggle) return;
    setIsExiting(true);
    setTimeout(() => {
      onToggle();
    }, 300);
  };

  // Calculate moving averages
  const calculateMA = (data: CandleData[], period: number) => {
    const result: Array<{ time: Time; value: number }> = [];
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      const avg = slice.reduce((sum, candle) => sum + candle.close, 0) / period;
      result.push({ time: data[i].time, value: avg });
    }
    return result;
  };

  const upsertAndSortCandle = (data: CandleData[], candle: CandleData) => {
    const next = [...data];
    const existingIndex = next.findIndex(c => c.time === candle.time);
    if (existingIndex >= 0) {
      next[existingIndex] = candle;
    } else {
      next.push(candle);
    }
    next.sort((a, b) => (a.time as number) - (b.time as number));
    return next;
  };

  // Fetch historical candles (Polymarket getPricesHistory when tokenId set, else backend candles)
  const fetchHistoricalCandles = async () => {
    if (!asset || asset.trim() === '') {
      setIsLoading(false);
      setHistoryLoaded(true);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setHistoryLoaded(false);
      // Clear old data so chart shows new timeframe and zoom is reapplied when new data arrives
      setCandleData([]);

      if (tokenId) {
        const response = await fetch(
          getPolymarketPricesHistoryUrl(tokenId, currentTimeframe)
        );
        if (!response.ok) {
          setIsLoading(false);
          setHistoryLoaded(true);
          return;
        }
        const json = await response.json();
        const history = Array.isArray(json) ? json : (json?.history ?? []);
        if (history.length > 0) {
          const formattedCandles: CandleData[] = history
            .map((point: { t: number; p: number }) => ({
              time: normalizeTime(point.t) as Time,
              open: Number(point.p),
              high: Number(point.p),
              low: Number(point.p),
              close: Number(point.p),
              volume: 0,
            }))
            .sort((a: CandleData, b: CandleData) => (a.time as number) - (b.time as number)); // oldest first so chart start = range start
          setCandleData(formattedCandles);
          const firstPrice = formattedCandles[0].close;
          const currentPrice = formattedCandles[formattedCandles.length - 1].close;
          const change = firstPrice > 0 ? ((currentPrice - firstPrice) / firstPrice) * 100 : 0;
          setPriceChange(change);
          setLastPrice(currentPrice);
        }
        setIsLoading(false);
        setHistoryLoaded(true);
        return;
      }

      if (!apiUrl) {
        setIsLoading(false);
        setHistoryLoaded(true);
        return;
      }
      const response = await fetch(`${apiUrl}/api/candles/${asset}/${currentTimeframe}?limit=20000`);

      if (!response.ok) {
        if (response.status === 400) {
          setIsLoading(false);
          setHistoryLoaded(true);
          return;
        }
        throw new Error(`Failed to fetch candles: ${response.statusText}`);
      }

      const { candles } = await response.json();

      if (candles && candles.length > 0) {
        const formattedCandles = candles
          .map((c: any) => ({
            ...c,
            time: normalizeTime(c.time) as Time  // API may send Unix s or ms; normalize to seconds
          }))
          .sort((a: CandleData, b: CandleData) => (a.time as number) - (b.time as number)); // oldest first

        setCandleData(formattedCandles);

        const firstPrice = formattedCandles[0].close;
        const currentPrice = formattedCandles[formattedCandles.length - 1].close;
        const change = ((currentPrice - firstPrice) / firstPrice) * 100;
        setPriceChange(change);
        setLastPrice(currentPrice);
      }

      setIsLoading(false);
      setHistoryLoaded(true);
    } catch (error) {
      const isNetworkError = error instanceof TypeError && ((error as Error).message === 'Failed to fetch' || (error as Error).message?.includes('fetch'));
      if (!isNetworkError) console.error('Error fetching historical candles:', error);
      setIsLoading(false);
      setHistoryLoaded(true);
    }
  };

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const themeKey = resolvedTheme === 'light' ? 'light' : 'dark';
    const chartTheme = CHART_THEMES[themeKey];

    const chart = createChart(chartContainerRef.current, {
      ...chartTheme,
      layout: { ...chartTheme.layout, fontSize: 11 },
      width: chartContainerRef.current.clientWidth,
      height: 240,
      timeScale: {
        ...chartTheme.timeScale,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 0,
        barSpacing: 3,
        minBarSpacing: 0.5,
      },
    });

    // Candlestick series
    const candleSeries = (chart as any).addCandlestickSeries({
      upColor: '#1CCA5B',
      downColor: '#ED2C2C',
      borderUpColor: '#1CCA5B',
      borderDownColor: '#ED2C2C',
      wickUpColor: '#3FFF84',
      wickDownColor: '#FF5E5E',
      borderVisible: false,
      wickVisible: true,
    });

    // Volume series
    const volumeSeries = (chart as any).addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    // Moving averages
    const ma7Series = (chart as any).addLineSeries({
      color: '#3b82f6',
      lineWidth: 2,
      title: 'MA(7)',
    });

    const ma25Series = (chart as any).addLineSeries({
      color: '#ec4899',
      lineWidth: 2,
      title: 'MA(25)',
    });

    // const ma99Series = (chart as any).addLineSeries({
    //   color: '#f59e0b',
    //   lineWidth: 2,
    //   title: 'MA(99)',
    // });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    ma7SeriesRef.current = ma7Series;
    ma25SeriesRef.current = ma25Series;
    // ma99SeriesRef.current = ma99Series;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Update chart theme when theme changes
  useEffect(() => {
    if (!chartRef.current) return;
    const themeKey = resolvedTheme === 'light' ? 'light' : 'dark';
    chartRef.current.applyOptions(CHART_THEMES[themeKey]);
  }, [resolvedTheme]);

  // Update timeScale when timeframe changes – time is Polymarket timestamp (Unix seconds)
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        timeScale: {
          secondsVisible: false,
          tickMarkFormatter: (time: Time, tickMarkType: any, locale: any) => {
            const ts = Number(time);
            if (!Number.isFinite(ts) || ts < 1e9) return '–';
            return formatTimeLabel(ts, currentTimeframe, typeof locale === 'string' ? locale : 'en-US');
          },
        },
        localization: {
          timeFormatter: (time: Time) => {
            const ts = Number(time);
            if (!Number.isFinite(ts) || ts < 1e9) return '–';
            return formatTimeLabel(ts, currentTimeframe, 'en-US');
          },
        },
      });
    }
  }, [currentTimeframe]);

  // Update chart with candle data
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    // Even if no data, set empty array to render chart
    if (candleData.length === 0) {
      candleSeriesRef.current.setData([]);
      if (volumeSeriesRef.current) {
        volumeSeriesRef.current.setData([]);
      }
      return;
    }

    const baseData = fillDataGaps(candleData, currentTimeframe);
    const haData = calculateHeikinAshi(baseData);
    // Use Polymarket timestamps directly – no logical index mapping
    candleSeriesRef.current.setData(haData);

    // Set volume data
    if (volumeSeriesRef.current) {
      const volumeData = haData
        .filter(c => c.volume !== undefined)
        .map(c => ({
          time: c.time,
          value: c.volume!,
          color: c.close >= c.open ? '#22c55e33' : '#ef444433'
        }));
      volumeSeriesRef.current.setData(volumeData);
    }

    // Calculate and set moving averages (times from baseData)
    if (baseData.length >= 7 && ma7SeriesRef.current) {
      ma7SeriesRef.current.setData(calculateMA(baseData, 7));
    }
    if (baseData.length >= 25 && ma25SeriesRef.current) {
      ma25SeriesRef.current.setData(calculateMA(baseData, 25));
    }

    // Apply visible range using actual timestamps from Polymarket
    if (!initialZoomAppliedRef.current && chartRef.current && haData.length > 0) {
      const times = haData.map(c => Number(c.time));
      const minTs = Math.min(...times);
      const maxTs = Math.max(...times);
      const rangeSec = TIMEFRAME_SECONDS[currentTimeframe];
      const fromTs = rangeSec ? Math.max(minTs, maxTs - rangeSec) : minTs;
      try {
        chartRef.current.timeScale().setVisibleRange({ from: fromTs as Time, to: maxTs as Time });
      } catch {
        chartRef.current.timeScale().fitContent();
      }
      initialZoomAppliedRef.current = true;
    }
  }, [candleData, currentTimeframe]);

  const [retryCount, setRetryCount] = useState(0);

  // Connect to WebSocket for real-time updates (only when wsUrl is set)
  useEffect(() => {
    if (!wsUrl) return;

    // Try to connect, but don't block if it fails
    let ws: WebSocket | null = null;
    let timeoutId: NodeJS.Timeout;

    if (!historyLoaded) {
      return;
    }


    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => { };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'connected') {
            // New backend format has market info nested
            if (message.market?.title) setWsMarketTitle(message.market.title);
            if (message.market?.image) setWsMarketImage(message.market.image);
          }

          if (message.type === 'market_changed') {
            if (message.title) setWsMarketTitle(message.title);
            if (message.image) setWsMarketImage(message.image);
          }

          // Backend now uses 'outcome' instead of 'asset'
          if (message.type === 'candle_update' &&
            message.outcome === asset &&
            message.timeframe === currentTimeframe) {

            const newCandle = message.candle;

            setCandleData(prevData => {
              const formattedCandle = {
                ...newCandle,
                time: normalizeTime(newCandle.time)
              };
              return upsertAndSortCandle(prevData, formattedCandle);
            });

            // Update last price
            setLastPrice(newCandle.close);

            // Update price change
            setCandleData(prev => {
              if (prev.length > 0) {
                const firstPrice = prev[0].close;
                const change = ((newCandle.close - firstPrice) / firstPrice) * 100;
                setPriceChange(change);
              }
              return prev;
            });
          }
        } catch {
          // Ignore parse/processing errors (e.g. malformed message)
        }
      };

      ws.onerror = () => {
        // Backend may not be running; avoid spamming console
      };

      ws.onclose = () => {
        // Try to reconnect after delay
        timeoutId = setTimeout(() => {
          setRetryCount(prev => prev + 1);
        }, 5000);
      };
    } catch {
      // Backend may not be running; avoid spamming console
      timeoutId = setTimeout(() => {
        setRetryCount(prev => prev + 1);
      }, 5000);
    }

    return () => {
      if (ws) {
        try {
          ws.close();
        } catch (e) {
          // Ignore close errors
        }
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [asset, currentTimeframe, wsUrl, historyLoaded, retryCount]);

  // Load historical candles on mount and when timeframe/asset/tokenId changes
  useEffect(() => {
    fetchHistoricalCandles();
  }, [asset, tokenId, currentTimeframe]);

  useEffect(() => {
    initialZoomAppliedRef.current = false;
  }, [asset, tokenId, currentTimeframe]);

  const formatPrice = (price: number) => {
    return `${(price * 100).toFixed(2)}¢`;
  };

  const formatChance = (price: number) => {
    return `${(price * 100).toFixed(2)}% chance`;
  };

  const formatPercent = (value: number) => {
    // const sign = value >= 0 ? '+' : '';
    // return `${sign}${Math.abs(value).toFixed(2)}%`; // Simplified for now
    return `▼ ${Math.abs(value).toFixed(2)}%`; // Using screenshot style for demo
  };

  // Parse title and subtitle
  // If we have a subtitle prop, use title as-is and subtitle separately
  // Otherwise parse from marketTitle for backward compatibility
  const mainTitle = propMarketSubtitle
    ? marketTitle
    : (marketTitle ? marketTitle.split(' - ')[0] : '');
  const subTitle = propMarketSubtitle
    ? propMarketSubtitle
    : (marketTitle ? marketTitle.split(' - ')[1] || '' : '');

  return (
    <div className={`h-[360px] w-full bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-2xl overflow-hidden shadow-lg dark:shadow-[0_20px_50px_rgba(0,0,0,0.35)] ${isExiting ? 'animate-fade-out' : 'animate-fade-in'}`}>
      {/* Header */}
      <div className="flex flex-col border-b border-gray-200 dark:border-[#1f2430] bg-white dark:bg-[#12161c] px-5 py-4">
        {showSkeleton ? (
          <div className="flex items-start justify-between animate-pulse">
            <div className="flex gap-4">
              <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-[#1f2430]" />
              <div className="flex flex-col gap-2">
                <div className="h-5 w-48 rounded bg-gray-200 dark:bg-[#1f2430]" />
                <div className="h-3 w-32 rounded bg-gray-200 dark:bg-[#1f2430]" />
                <div className="h-4 w-24 rounded bg-gray-200 dark:bg-[#1f2430]" />
              </div>
            </div>
            <div className="flex flex-col items-end gap-3">
              <div className="h-4 w-12 rounded bg-gray-200 dark:bg-[#1f2430]" />
              <div className="h-6 w-36 rounded-full bg-gray-200 dark:bg-[#1f2430]" />
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between">
            <div className="flex gap-4">
              {/* Large Icon */}
              {marketImage && (
                <img
                  src={marketImage}
                  alt="Market"
                  className="w-12 h-12 rounded-full border border-gray-300 dark:border-[#2a3140]"
                />
              )}

              <div className="flex flex-col">
                {/* Title */}
                <h1 className="text-xl font-semibold text-gray-900 dark:text-white leading-tight">
                  {mainTitle}
                </h1>
                {/* Subtitle */}
                {subTitle && (
                  <span className="text-sm text-gray-500 dark:text-[#8b94a3] mt-0.5">
                    {subTitle}
                  </span>
                )}

                {/* Price/Chance Info */}
                {lastPrice !== null && (
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className={`text-xs font-semibold uppercase ${lastPrice >= 0.5 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                      {asset.replace(/_/g, ' ').toUpperCase()}
                    </span>
                    <span className={`text-base font-semibold ${lastPrice >= 0.5 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                      {formatChance(lastPrice)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right Side Controls */}
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2 text-gray-500 dark:text-[#7d8795]">
                <button className="hover:text-gray-900 dark:hover:text-white transition-colors"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></button>
                <button className="hover:text-gray-900 dark:hover:text-white transition-colors"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg></button>
              </div>

              <div className="flex items-center gap-2 mt-4">
                {onToggle && (
                  <button
                    onClick={handleToggle}
                    className=" hover:bg-gray-100 dark:hover:bg-[#1a1f28] rounded text-[20px] leading-none transition-colors text-gray-500 dark:text-[#7d8795]"
                    title="Switch Chart"
                  >
                    Switch
                  </button>
                )}

                {/* Timeframe selector */}
                <div className="flex items-center bg-gray-50 dark:bg-[#0f131a] rounded-full border border-gray-200 dark:border-[#222a36]">
                  <div
                    className="relative flex items-center"
                    style={{ width: timeframeButtonWidth * timeframes.length }}
                  >
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-[#2f6df6] transition-transform duration-200 ease-out"
                      style={{
                        width: timeframeButtonWidth,
                        transform: `translateX(${activeTimeframeIndex * timeframeButtonWidth}px)`
                      }}
                    />
                    {timeframes.map((tf) => (
                      <button
                        key={tf}
                        onClick={() => setCurrentTimeframe(tf)}
                        className={`relative z-10 flex items-center justify-center text-[12px] font-semibold rounded-full transition-colors duration-200 ease-out ${currentTimeframe === tf
                          ? 'text-white'
                          : 'text-gray-500 dark:text-[#7d8795] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#1a1f28]'
                          }`}
                        style={{ width: timeframeButtonWidth, height: timeframeButtonHeight }}
                      >
                        {tf === 'max' ? 'All' : tf.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="relative">
        {showSkeleton && (
          <div className="absolute inset-0 z-10 flex flex-col gap-3 bg-white/90 dark:bg-[#12161c]/90 p-4 animate-pulse">
            <div className="h-40 w-full rounded bg-gray-200 dark:bg-[#1f2430]" />
            <div className="h-24 w-full rounded bg-gray-200 dark:bg-[#1f2430]" />
          </div>
        )}
        {isLoading && !showSkeleton && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-[#12161c]/80 z-10">
            <div className="text-gray-500 dark:text-[#7d8795] text-xs">Loading...</div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-[#12161c]/80 z-10">
            <div className="text-red-400 text-xs">{error}</div>
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-[240px]" />
      </div>

      {/* Moving Average Legend */}
      <div className="px-4 py-2 border-t border-gray-200 dark:border-[#1f2430] flex items-center gap-4 text-[10px]">
        {showSkeleton ? (
          <div className="flex items-center gap-3 animate-pulse">
            <div className="h-2 w-12 rounded bg-gray-200 dark:bg-[#1f2430]" />
            <div className="h-2 w-12 rounded bg-gray-200 dark:bg-[#1f2430]" />
            <div className="h-2 w-12 rounded bg-gray-200 dark:bg-[#1f2430]" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1">
              <div className="w-2 h-0.5 bg-[#3b82f6]"></div>
              <span className="text-[#3b82f6]">MA(7)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-0.5 bg-[#ec4899]"></div>
              <span className="text-[#ec4899]">MA(25)</span>
            </div>
            {/* <div className="flex items-center gap-1">
              <div className="w-2 h-0.5 bg-[#f59e0b]"></div>
              <span className="text-[#f59e0b]">MA(99)</span>
            </div> */}
          </>
        )}
      </div>
    </div>
  );
}

