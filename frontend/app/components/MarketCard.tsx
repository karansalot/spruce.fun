'use client';

import Link from 'next/link';

type MarketOutcome = {
  label: string;
  percent: number;
};

type MarketCardBase = {
  title: string;
  slug: string;
  category: 'Sports' | 'Crypto';
  volume: string;
  icon: string | null;
  subtitle?: string;
};

type MultiOutcomeCard = MarketCardBase & {
  variant: 'multi';
  outcomes: MarketOutcome[];
};

type BinaryCard = MarketCardBase & {
  variant: 'binary';
  percent: number;
  primaryLabel: string;
  secondaryLabel: string;
  statusLabel?: string;
};

type MarketCardProps = MultiOutcomeCard | BinaryCard;

const formatPercent = (value: number) => `${value.toFixed(2)}%`;

export default function MarketCard(props: MarketCardProps) {
  const ringStyle = (percent: number) => ({
    background: `conic-gradient(#5cc08a ${percent}%, #2a313d 0)`,
  });

  return (
    <Link
      href={`/market/${props.slug}`}
      className="block rounded-xl border border-gray-200 dark:border-[#1a2332] bg-white dark:bg-[#0c111a] p-4 transition-shadow hover:shadow-[0_18px_40px_rgba(0,0,0,0.35)] hover:bg-gray-50 dark:hover:bg-[#0f1520]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-[#1a2d4d] text-lg">
            {props.icon?.startsWith('http') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={props.icon}
                alt={props.title}
                className="h-7 w-7 object-contain"
              />
            ) : (
              props.icon ?? ''
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{props.title}</h3>
            {props.subtitle && (
              <p className="text-xs text-gray-400 mt-1">{props.subtitle}</p>
            )}
          </div>
        </div>
        {props.variant === 'binary' && (
          <div className="flex items-center gap-2">
            <div
              className="h-11 w-11 rounded-full p-[3px]"
              style={ringStyle(props.percent)}
            >
              <div className="h-full w-full rounded-full bg-white dark:bg-[#0c111a] flex items-center justify-center text-xs font-semibold text-gray-900 dark:text-white">
                {formatPercent(props.percent)}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {props.variant === 'multi' ? (
          [...props.outcomes]
            .sort((a, b) => b.percent - a.percent)
            .slice(0, 2)
            .map((outcome) => (
              <div key={outcome.label} className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{outcome.label}</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {formatPercent(outcome.percent)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-[#15803d] px-4 py-1.5 text-[11px] font-semibold text-white hover:bg-[#16a34a] transition-colors">
                      Yes
                    </span>
                    <span className="rounded-lg bg-[#991b1b] px-4 py-1.5 text-[11px] font-semibold text-white hover:bg-[#dc2626] transition-colors">
                      No
                    </span>
                  </div>
                </div>
              </div>
            ))
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="rounded-lg bg-[#15803d] py-2 text-xs font-semibold text-white hover:bg-[#16a34a] transition-colors"
            >
              {props.primaryLabel}
            </button>
            <button
              type="button"
              className="rounded-lg bg-[#991b1b] py-2 text-xs font-semibold text-white hover:bg-[#dc2626] transition-colors"
            >
              {props.secondaryLabel}
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-gray-400">
        <span>{props.volume} Vol.</span>
        <div className="flex items-center gap-3 text-sm">
        </div>
      </div>

      {props.variant === 'binary' && props.statusLabel && (
        <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
          <span className="h-2 w-2 rounded-full bg-red-500"></span>
          <span>{props.statusLabel}</span>
        </div>
      )}
    </Link>
  );
}
