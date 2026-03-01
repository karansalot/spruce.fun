'use client';

import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { SOLANA_RPC } from '../../lib/constants';
import { CustomWalletModalProvider } from '../components/CustomWalletModalProvider';

import '@solana/wallet-adapter-react-ui/styles.css';

export default function SolanaWalletProviderWrapper({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => SOLANA_RPC, []);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <CustomWalletModalProvider>{children}</CustomWalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
