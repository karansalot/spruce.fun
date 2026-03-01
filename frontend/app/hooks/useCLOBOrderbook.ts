import { useEffect, useState } from 'react';
import { generateCLOBSymbol } from '../lib/clobSymbols';

interface UseCLOBOrderbookOptions {
  slug: string;
  marketType: 'binary' | 'multi';
  outcome?: string;
  autoInitialize?: boolean;
}

export function useCLOBOrderbook({ slug, marketType, outcome }: UseCLOBOrderbookOptions) {
  const [symbol, setSymbol] = useState<string>('');

  useEffect(() => {
    const newSymbol = generateCLOBSymbol(slug, marketType, outcome);
    setSymbol(newSymbol);
  }, [slug, marketType, outcome]);

  return {
    symbol,
    isInitialized: true,
    isInitializing: false,
    error: null,
  };
}
