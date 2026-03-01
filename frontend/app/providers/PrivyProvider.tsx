'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

const queryClient = new QueryClient();

export default function PrivyProviderWrapper({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div suppressHydrationWarning>{children}</div>;
  }

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
