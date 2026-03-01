'use client';

import type { ReactNode } from 'react';
import React, { useState } from 'react';
import { WalletModalContext } from '@solana/wallet-adapter-react-ui';
import { CustomWalletModal } from './CustomWalletModal';

export interface CustomWalletModalProviderProps {
  children: ReactNode;
  className?: string;
  container?: string;
}

/** Provider that renders CustomWalletModal (deduplicated wallet keys) instead of the default. */
export function CustomWalletModalProvider({
  children,
  ...modalProps
}: CustomWalletModalProviderProps) {
  const [visible, setVisible] = useState(false);

  return (
    <WalletModalContext.Provider value={{ visible, setVisible }}>
      {children}
      {visible && <CustomWalletModal {...modalProps} />}
    </WalletModalContext.Provider>
  );
}
