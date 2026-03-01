'use client';

import { PrivyProvider } from '@privy-io/react-auth';

export default function PrivyProviderWrapper({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || 'your-privy-app-id'}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#667eea',
          logo: 'https://your-logo-url.com/logo.png',
        },
        loginMethods: ['wallet', 'email', 'google'],
      }}
    >
      {children}
    </PrivyProvider>
  );
}

