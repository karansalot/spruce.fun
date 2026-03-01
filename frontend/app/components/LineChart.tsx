'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  Time,
  LineStyle,
  CrosshairMode
} from 'lightweight-charts';
import { getPolymarketPricesHistoryUrl } from '@/lib/polymarketApi';
import { DEFAULT_API_URL, DEFAULT_WS_URL } from '@/lib/constants';

const LINE_CHART_THEMES = {
  dark: {
    layout: { background: { type: ColorType.Solid, color: '#12161c' }, textColor: '#8b94a3', fontSize: 11, fontFamily: 'Inter, sans-serif' },
    grid: { vertLines: { color: '#1b202a' }, horzLines: { color: '#1b202a' } },
    timeScale: { borderColor: '#1b202a' },
    rightPriceScale: { borderColor: '#1b202a' },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#666', width: 1 as const, style: LineStyle.Dotted, labelBackgroundColor: '#1f2430' },
      horzLine: { color: '#666', width: 1 as const, style: LineStyle.Dotted, labelBackgroundColor: '#1f2430' },
    },
  },
  light: {
    layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#6b7280', fontSize: 11, fontFamily: 'Inter, sans-serif' },
    grid: { vertLines: { color: '#f3f4f6' }, horzLines: { color: '#f3f4f6' } },
    timeScale: { borderColor: '#e5e7eb' },
    rightPriceScale: { borderColor: '#e5e7eb' },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#9ca3af', width: 1 as const, style: LineStyle.Dotted, labelBackgroundColor: '#f3f4f6' },
      horzLine: { color: '#9ca3af', width: 1 as const, style: LineStyle.Dotted, labelBackgroundColor: '#f3f4f6' },
    },
  },
} as const;

interface TeamSpec {
  asset: string;
  name: string;
  color: string;
  /** Optional CLOB token ID; when set, chart fetches from Polymarket getPricesHistory. */
  tokenId?: string;
}

interface LineChartProps {
  team1: TeamSpec;
  team2: TeamSpec;
  team3?: TeamSpec;
  team4?: TeamSpec;
  timeframe?: '1m' | '1h' | '6h' | '1d' | '1w' | 'max';
  wsUrl?: string;
  apiUrl?: string;
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
}

interface LineData {
  time: Time;
  value: number;
}

/** Normalize API time to Unix seconds. API may send seconds or milliseconds. */
const normalizeTime = (time: Time | number | string): Time => {
  const numeric = Number(time);
  if (!Number.isFinite(numeric)) {
    return time as Time;
  }
  // Milliseconds (e.g. JS Date.now() or Polymarket ms) -> seconds
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
  // 1d, 1w: date + time so multiple ticks per day are distinct
  return date.toLocaleDateString(safeLocale, opts)
    + ', ' + date.toLocaleTimeString(safeLocale, timeOpts);
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
  if (!interval) return data;

  const filledData: CandleData[] = [];
  const sortedData = [...data].sort((a, b) => (a.time as number) - (b.time as number));

  filledData.push(sortedData[0]);

  for (let i = 1; i < sortedData.length; i++) {
    const prev = sortedData[i - 1];
    const curr = sortedData[i];
    const prevTime = prev.time as number;
    const currTime = curr.time as number;

    if (currTime - prevTime > interval) {
      let nextTime = prevTime + interval;
      const maxFill = 10000;
      let fillCount = 0;

      while (nextTime < currTime && fillCount < maxFill) {
        filledData.push({
          time: nextTime as Time,
          open: prev.close,
          high: prev.close,
          low: prev.close,
          close: prev.close,
          volume: 0,
        });
        nextTime += interval;
        fillCount++;
      }
    }
    filledData.push(curr);
  }
  return filledData;
};

// Use hosted backend URLs (default: perpmarket-production)
const getDefaultWsUrl = () => DEFAULT_WS_URL;
const getDefaultApiUrl = () => DEFAULT_API_URL;

export default function LineChart({
  team1,
  team2,
  team3,
  team4,
  timeframe = '1m',
  wsUrl = getDefaultWsUrl(),
  apiUrl = getDefaultApiUrl(),
  marketTitle,
  marketImage,
  marketSubtitle
}: LineChartProps) {
  const { resolvedTheme } = useTheme();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const series1Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const series2Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const series3Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const series4Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const initialZoomAppliedRef = useRef(false);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data1, setData1] = useState<CandleData[]>([]);
  const [data2, setData2] = useState<CandleData[]>([]);
  const [data3, setData3] = useState<CandleData[]>([]);
  const [data4, setData4] = useState<CandleData[]>([]);
  const [currentTimeframe, setCurrentTimeframe] = useState(timeframe);
  const [historyLoaded1, setHistoryLoaded1] = useState(false);
  const [historyLoaded2, setHistoryLoaded2] = useState(false);
  const [historyLoaded3, setHistoryLoaded3] = useState(false);
  const [historyLoaded4, setHistoryLoaded4] = useState(false);

  const [currentPrice1, setCurrentPrice1] = useState<number | null>(null);
  const [currentPrice2, setCurrentPrice2] = useState<number | null>(null);
  const [currentPrice3, setCurrentPrice3] = useState<number | null>(null);
  const [currentPrice4, setCurrentPrice4] = useState<number | null>(null);

  const timeframes = ['1h', '6h', '1d', '1w', '1m', 'max'] as const;
  const timeframeButtonWidth = 52;
  const timeframeButtonHeight = 30;
  const activeTimeframeIndex = Math.max(0, timeframes.indexOf(currentTimeframe));

  /** Strip " Yes" / " No" from outcome names for legend display */
  const legendLabel = (name: string | undefined) =>
    name?.replace(/\s+(Yes|No)$/i, '').trim() ?? '';

  const hasTeam3 = Boolean(team3?.asset);
  const hasTeam4 = Boolean(team4?.asset);
  const showSkeleton =
    isLoading &&
    !error &&
    (data1.length === 0 || data2.length === 0 ||
      (hasTeam3 && data3.length === 0) ||
      (hasTeam4 && data4.length === 0));

  /** Convert candle data to line data using Polymarket timestamps directly (Unix seconds). */
  const toLineData = (data: CandleData[]): LineData[] =>
    data.map(c => ({ time: c.time as Time, value: c.close * 100 }));

  /** Lightweight Charts requires strictly ascending unique times. Dedupe by time, keeping last value. */
  const sortAndDedupeByTime = (lineData: LineData[]): LineData[] => {
    if (lineData.length <= 1) return lineData;
    const byTime = new Map<number, number>();
    for (const p of lineData) {
      const t = Number(p.time);
      byTime.set(t, p.value);
    }
    return Array.from(byTime.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => ({ time: time as Time, value }));
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

  /** Map chart timeframe to Polymarket CLOB prices-history interval (see docs.polymarket.com/developers/CLOB/clients/methods-public#getpriceshistory). */
  const pricesHistoryInterval = currentTimeframe;

  // Fetch historical data for a team (Polymarket getPricesHistory when tokenId set, else backend candles)
  const fetchHistory = async (
    asset: string,
    tokenId: string | undefined,
    setData: (d: CandleData[]) => void,
    setLoaded: (b: boolean) => void,
    setPrice: (n: number) => void
  ) => {
    if (!asset || asset.trim() === '') {
      setLoaded(true);
      return;
    }

    try {
      if (tokenId) {
        const response = await fetch(
          getPolymarketPricesHistoryUrl(tokenId, pricesHistoryInterval)
        );
        if (!response.ok) {
          setLoaded(true);
          return;
        }
        const json = await response.json();
        const history = Array.isArray(json) ? json : (json?.history ?? []);
        if (history.length > 0) {
          const mapped: CandleData[] = history.map((point: { t: number; p: number }) => ({
            time: normalizeTime(point.t) as Time,
            open: Number(point.p),
            high: Number(point.p),
            low: Number(point.p),
            close: Number(point.p),
            volume: 0,
          }));
          const formatted = mapped.sort((a, b) => (a.time as number) - (b.time as number)); // oldest first so chart start = range start
          setData(formatted);
          setPrice(formatted[formatted.length - 1].close);
        }
        setLoaded(true);
        return;
      }

      if (!apiUrl) {
        setLoaded(true);
        return;
      }
      const response = await fetch(`${apiUrl}/api/candles/${asset}/${currentTimeframe}?limit=20000`);
      if (!response.ok) {
        if (response.status === 400) {
          // Candles not available
        }
        setLoaded(true);
        return;
      }
      const { candles } = await response.json();
      if (candles && candles.length > 0) {
        const formatted = candles
          .map((c: { time: number; open: number; high: number; low: number; close: number }) => ({
            ...c,
            time: normalizeTime(c.time) as Time  // API may send Unix s or ms; normalize to seconds
          }))
          .sort((a: CandleData, b: CandleData) => (a.time as number) - (b.time as number)); // oldest first
        setData(formatted);
        setPrice(formatted[formatted.length - 1].close);
      }
      setLoaded(true);
    } catch (e) {
      // Avoid spamming console when backend is not running (e.g. connection refused)
      const isNetworkError = e instanceof TypeError && (e.message === 'Failed to fetch' || String(e.message).includes('fetch'));
      if (!isNetworkError) console.error(`Error fetching history for ${asset}:`, e);
      setLoaded(true);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    setHistoryLoaded1(false);
    setHistoryLoaded2(false);
    setHistoryLoaded3(false);
    setHistoryLoaded4(false);
    // Clear old data so chart doesn't show previous timeframe and zoom is reapplied when new data arrives
    setData1([]);
    setData2([]);
    setData3([]);
    setData4([]);

    const promises: Promise<void>[] = [
      fetchHistory(team1.asset, team1.tokenId, setData1, setHistoryLoaded1, setCurrentPrice1),
      fetchHistory(team2.asset, team2.tokenId, setData2, setHistoryLoaded2, setCurrentPrice2),
    ];
    if (team3?.asset) {
      promises.push(fetchHistory(team3.asset, team3.tokenId, setData3, setHistoryLoaded3, setCurrentPrice3));
    } else {
      setData3([]);
      setCurrentPrice3(null);
      setHistoryLoaded3(true);
    }
    if (team4?.asset) {
      promises.push(fetchHistory(team4.asset, team4.tokenId, setData4, setHistoryLoaded4, setCurrentPrice4));
    } else {
      setData4([]);
      setCurrentPrice4(null);
      setHistoryLoaded4(true);
    }

    Promise.all(promises).then(() => {
      setIsLoading(false);
    });
  }, [team1.asset, team1.tokenId, team2.asset, team2.tokenId, team3?.asset, team3?.tokenId, team4?.asset, team4?.tokenId, currentTimeframe]);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const themeKey = resolvedTheme === 'light' ? 'light' : 'dark';
    const chartTheme = LINE_CHART_THEMES[themeKey];

    const chart = createChart(chartContainerRef.current, {
      ...chartTheme,
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

    const s1 = chart.addLineSeries({
      color: team1.color,
      lineWidth: 2,
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => `${price.toFixed(2)}%`,
      },
      title: legendLabel(team1.name),
    });

    const s2 = chart.addLineSeries({
      color: team2.color,
      lineWidth: 2,
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => `${price.toFixed(2)}%`,
      },
      title: legendLabel(team2.name),
    });

    let s3: ISeriesApi<'Line'> | null = null;
    let s4: ISeriesApi<'Line'> | null = null;
    if (team3) {
      s3 = chart.addLineSeries({
        color: team3.color,
        lineWidth: 2,
        priceFormat: {
          type: 'custom',
          formatter: (price: number) => `${price.toFixed(2)}%`,
        },
        title: legendLabel(team3.name),
      });
    }
    if (team4) {
      s4 = chart.addLineSeries({
        color: team4.color,
        lineWidth: 2,
        priceFormat: {
          type: 'custom',
          formatter: (price: number) => `${price.toFixed(2)}%`,
        },
        title: legendLabel(team4.name),
      });
    }

    chartRef.current = chart;
    series1Ref.current = s1;
    series2Ref.current = s2;
    series3Ref.current = s3;
    series4Ref.current = s4;

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
  }, [team1.color, team2.color, team1.name, team2.name, team3?.color, team3?.name, team4?.color, team4?.name]);

  // Update chart theme when theme changes
  useEffect(() => {
    if (!chartRef.current) return;
    const themeKey = resolvedTheme === 'light' ? 'light' : 'dark';
    chartRef.current.applyOptions(LINE_CHART_THEMES[themeKey]);
  }, [resolvedTheme]);

  // Update Data – use Polymarket timestamps directly for consistent timeline
  useEffect(() => {
    if (!series1Ref.current || !series2Ref.current) return;

    const d1Filled = fillDataGaps(data1, currentTimeframe);
    const d2Filled = fillDataGaps(data2, currentTimeframe);
    const d3Filled = fillDataGaps(data3, currentTimeframe);
    const d4Filled = fillDataGaps(data4, currentTimeframe);

    const lineData1 = sortAndDedupeByTime(toLineData(d1Filled));
    const lineData2 = sortAndDedupeByTime(toLineData(d2Filled));
    const lineData3 = sortAndDedupeByTime(toLineData(d3Filled));
    const lineData4 = sortAndDedupeByTime(toLineData(d4Filled));

    series1Ref.current.setData(lineData1);
    series2Ref.current.setData(lineData2);
    if (series3Ref.current) series3Ref.current.setData(lineData3);
    if (series4Ref.current) series4Ref.current.setData(lineData4);

    // Apply visible range using actual timestamps from Polymarket
    const hasData = lineData1.length > 0 || lineData2.length > 0 || lineData3.length > 0 || lineData4.length > 0;
    if (!initialZoomAppliedRef.current && chartRef.current && hasData) {
      const allTimes: number[] = [];
      [lineData1, lineData2, lineData3, lineData4].forEach(ld => ld.forEach(p => allTimes.push(Number(p.time))));
      const minTs = Math.min(...allTimes);
      const maxTs = Math.max(...allTimes);
      const rangeSec = TIMEFRAME_SECONDS[currentTimeframe];
      const fromTs = rangeSec ? Math.max(minTs, maxTs - rangeSec) : minTs;
      try {
        chartRef.current.timeScale().setVisibleRange({ from: fromTs as Time, to: maxTs as Time });
      } catch {
        chartRef.current.timeScale().fitContent();
      }
      initialZoomAppliedRef.current = true;
    }
  }, [data1, data2, data3, data4, currentTimeframe]);

  // Update Formatters – time is now Polymarket timestamp (Unix seconds)
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        timeScale: {
          secondsVisible: false,
          tickMarkFormatter: (time: Time, tickMarkType: any, locale: any) => {
            const ts = Number(time);
            if (!Number.isFinite(ts) || ts < 1e9) return '–';
            return formatTimeLabel(ts, currentTimeframe, locale);
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

  // WebSocket (only when a hosted backend URL is set)
  useEffect(() => {
    if (!wsUrl) return;

    const allLoaded =
      historyLoaded1 &&
      historyLoaded2 &&
      (!hasTeam3 || historyLoaded3) &&
      (!hasTeam4 || historyLoaded4);
    if (!allLoaded) return;

    let ws: WebSocket | null = null;
    let timeoutId: NodeJS.Timeout;

    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => { };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'candle_update' && message.timeframe === currentTimeframe) {
            const newCandle = {
              ...message.candle,
              time: normalizeTime(message.candle.time)
            };

            if (message.outcome === team1.asset) {
              setData1(prev => upsertAndSortCandle(prev, newCandle));
              setCurrentPrice1(newCandle.close);
            } else if (message.outcome === team2.asset) {
              setData2(prev => upsertAndSortCandle(prev, newCandle));
              setCurrentPrice2(newCandle.close);
            } else if (team3 && message.outcome === team3.asset) {
              setData3(prev => upsertAndSortCandle(prev, newCandle));
              setCurrentPrice3(newCandle.close);
            } else if (team4 && message.outcome === team4.asset) {
              setData4(prev => upsertAndSortCandle(prev, newCandle));
              setCurrentPrice4(newCandle.close);
            }
          }
        } catch (err) {
          console.error('Error processing WS message', err);
        }
      };

      ws.onclose = () => {
        timeoutId = setTimeout(() => { }, 5000);
      };
    } catch (e) {
      // Backend may not be running; avoid spamming console
    }

    return () => {
      if (ws) ws.close();
      if (timeoutId) clearTimeout(timeoutId);
    };

  }, [team1.asset, team2.asset, team3?.asset, team4?.asset, currentTimeframe, wsUrl, historyLoaded1, historyLoaded2, historyLoaded3, historyLoaded4, hasTeam3, hasTeam4]);

  // Reset zoom when timeframe changes so new data gets correct initial range
  useEffect(() => {
    initialZoomAppliedRef.current = false;
  }, [currentTimeframe]);

  return (
    <div className="h-[360px] w-full bg-white dark:bg-[#12161c] border border-gray-200 dark:border-[#1f2430] rounded-2xl overflow-hidden shadow-lg dark:shadow-[0_20px_50px_rgba(0,0,0,0.35)] animate-fade-in">
      {/* Header */}
      <div className="flex flex-col border-b border-gray-200 dark:border-[#1f2430] bg-white dark:bg-[#12161c] px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-4 min-w-0 flex-1">
            {marketImage && (
              <img src={marketImage} alt="Market" className="w-12 h-12 rounded-full border border-gray-300 dark:border-[#2a3140] shrink-0" />
            )}
            <div className="flex flex-col min-w-0 flex-1">
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white leading-tight">{marketTitle}</h1>
              {marketSubtitle && <span className="text-sm text-gray-500 dark:text-[#8b94a3] mt-0.5">{marketSubtitle}</span>}

              <div className="flex flex-nowrap items-baseline gap-4 mt-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {currentPrice1 !== null && (
                  <div className="flex items-center gap-1 shrink-0 whitespace-nowrap">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: team1.color }}></div>
                    <span className="text-sm text-gray-500 dark:text-[#8b94a3]">{legendLabel(team1.name)}:</span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{(currentPrice1 * 100).toFixed(2)}%</span>
                  </div>
                )}
                {currentPrice2 !== null && (
                  <div className="flex items-center gap-1 shrink-0 whitespace-nowrap">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: team2.color }}></div>
                    <span className="text-sm text-gray-500 dark:text-[#8b94a3]">{legendLabel(team2.name)}:</span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{(currentPrice2 * 100).toFixed(2)}%</span>
                  </div>
                )}
                {team3 && currentPrice3 !== null && (
                  <div className="flex items-center gap-1 shrink-0 whitespace-nowrap">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: team3.color }}></div>
                    <span className="text-sm text-gray-500 dark:text-[#8b94a3]">{legendLabel(team3.name)}:</span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{(currentPrice3 * 100).toFixed(2)}%</span>
                  </div>
                )}
                {team4 && currentPrice4 !== null && (
                  <div className="flex items-center gap-1 shrink-0 whitespace-nowrap">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: team4.color }}></div>
                    <span className="text-sm text-gray-500 dark:text-[#8b94a3]">{legendLabel(team4.name)}:</span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{(currentPrice4 * 100).toFixed(2)}%</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Timeframe Selector */}
          <div className="flex items-center bg-gray-50 dark:bg-[#0f131a] rounded-full border border-gray-200 dark:border-[#222a36] self-start mt-2">
            <div className="relative flex items-center" style={{ width: timeframeButtonWidth * timeframes.length }}>
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

      <div className="relative">
        {showSkeleton && (
          <div className="absolute inset-0 z-10 flex flex-col gap-3 bg-white/90 dark:bg-[#12161c]/90 p-4 animate-pulse">
            <div className="h-40 w-full rounded bg-gray-200 dark:bg-[#1f2430]" />
            <div className="h-24 w-full rounded bg-gray-200 dark:bg-[#1f2430]" />
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-[240px]" />
      </div>
    </div>
  );
}
