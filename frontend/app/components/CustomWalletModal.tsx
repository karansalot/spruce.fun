'use client';

import type { WalletName } from '@solana/wallet-adapter-base';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import type { Wallet } from '@solana/wallet-adapter-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletIcon } from '@solana/wallet-adapter-react-ui';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import type { FC, MouseEvent } from 'react';
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface CustomWalletModalProps {
  className?: string;
  container?: string;
}

/** Deduplicate wallets by adapter name (keep first) to avoid duplicate React keys. */
function dedupeWallets(wallets: Wallet[]): Wallet[] {
  const seen = new Set<string>();
  return wallets.filter((w) => {
    const name = w.adapter.name;
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

export const CustomWalletModal: FC<CustomWalletModalProps> = ({
  className = '',
  container = 'body',
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const { wallets, select } = useWallet();
  const { setVisible } = useWalletModal();
  const [expanded, setExpanded] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);
  const [portal, setPortal] = useState<Element | null>(null);

  const uniqueWallets = useMemo(() => dedupeWallets(wallets), [wallets]);

  const [listedWallets, collapsedWallets] = useMemo(() => {
    const installed: Wallet[] = [];
    const notInstalled: Wallet[] = [];

    for (const wallet of uniqueWallets) {
      if (wallet.readyState === WalletReadyState.Installed) {
        installed.push(wallet);
      } else {
        notInstalled.push(wallet);
      }
    }

    return installed.length ? [installed, notInstalled] : [notInstalled, []];
  }, [uniqueWallets]);

  const hideModal = useCallback(() => {
    setFadeIn(false);
    setTimeout(() => setVisible(false), 150);
  }, [setVisible]);

  const handleClose = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      hideModal();
    },
    [hideModal]
  );

  const handleWalletClick = useCallback(
    (event: MouseEvent, walletName: WalletName) => {
      select(walletName);
      handleClose(event);
    },
    [select, handleClose]
  );

  const handleCollapseClick = useCallback(() => setExpanded(!expanded), [expanded]);

  const handleTabKey = useCallback(
    (event: KeyboardEvent) => {
      const node = ref.current;
      if (!node) return;

      const focusableElements = node.querySelectorAll('button');
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === firstElement && lastElement) {
          lastElement.focus();
          event.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement && firstElement) {
          firstElement.focus();
          event.preventDefault();
        }
      }
    },
    [ref]
  );

  useLayoutEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hideModal();
      } else if (event.key === 'Tab') {
        handleTabKey(event);
      }
    };

    const { overflow } = window.getComputedStyle(document.body);
    setTimeout(() => setFadeIn(true), 0);
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown, false);

    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', handleKeyDown, false);
    };
  }, [hideModal, handleTabKey]);

  useLayoutEffect(() => setPortal(document.querySelector(container)), [container]);

  return (
    portal &&
    createPortal(
      <div
        aria-labelledby="wallet-adapter-modal-title"
        aria-modal="true"
        className={`wallet-adapter-modal ${fadeIn ? 'wallet-adapter-modal-fade-in' : ''} ${className}`}
        ref={ref}
        role="dialog"
      >
        <div className="wallet-adapter-modal-container">
          <div className="wallet-adapter-modal-wrapper">
            <button
              onClick={handleClose}
              className="wallet-adapter-modal-button-close"
              type="button"
            >
              <svg width="14" height="14">
                <path d="M14 12.461 8.3 6.772l5.234-5.233L12.006 0 6.772 5.234 1.54 0 0 1.539l5.234 5.233L0 12.006l1.539 1.528L6.772 8.3l5.69 5.7L14 12.461z" />
              </svg>
            </button>
            {listedWallets.length ? (
              <>
                <h1 className="wallet-adapter-modal-title">
                  Connect a wallet on Solana to continue
                </h1>
                <ul className="wallet-adapter-modal-list">
                  {listedWallets.map((wallet, index) => (
                    <li key={`${wallet.adapter.name}-${index}`}>
                      <button
                        className="wallet-adapter-button"
                        type="button"
                        onClick={(event) => handleWalletClick(event, wallet.adapter.name)}
                      >
                        <i className="wallet-adapter-button-start-icon">
                          <WalletIcon wallet={wallet} />
                        </i>
                        {wallet.adapter.name}
                        {wallet.readyState === WalletReadyState.Installed && (
                          <span>Detected</span>
                        )}
                      </button>
                    </li>
                  ))}
                  {collapsedWallets.length ? (
                    <div
                      className="wallet-adapter-collapse"
                      id="wallet-adapter-modal-collapse"
                      role="region"
                      style={{
                        height: expanded ? 'auto' : 0,
                        overflow: expanded ? 'initial' : 'hidden',
                        transition: 'height 250ms ease-out',
                      }}
                    >
                      {collapsedWallets.map((wallet, index) => (
                        <li key={`${wallet.adapter.name}-collapsed-${index}`}>
                          <button
                            className="wallet-adapter-button"
                            type="button"
                            tabIndex={expanded ? 0 : -1}
                            onClick={(event) =>
                              handleWalletClick(event, wallet.adapter.name)
                            }
                          >
                            <i className="wallet-adapter-button-start-icon">
                              <WalletIcon wallet={wallet} />
                            </i>
                            {wallet.adapter.name}
                          </button>
                        </li>
                      ))}
                    </div>
                  ) : null}
                </ul>
                {collapsedWallets.length ? (
                  <button
                    className="wallet-adapter-modal-list-more"
                    onClick={handleCollapseClick}
                    tabIndex={0}
                    type="button"
                  >
                    <span>{expanded ? 'Less ' : 'More '}options</span>
                    <svg
                      width="13"
                      height="7"
                      viewBox="0 0 13 7"
                      xmlns="http://www.w3.org/2000/svg"
                      className={
                        expanded ? 'wallet-adapter-modal-list-more-icon-rotate' : ''
                      }
                    >
                      <path d="M0.71418 1.626L5.83323 6.26188C5.91574 6.33657 6.0181 6.39652 6.13327 6.43762C6.24844 6.47872 6.37371 6.5 6.50048 6.5C6.62725 6.5 6.75252 6.47872 6.8677 6.43762C6.98287 6.39652 7.08523 6.33657 7.16774 6.26188L12.2868 1.626C12.7753 1.1835 12.3703 0.5 11.6195 0.5H1.37997C0.629216 0.5 0.224175 1.1835 0.71418 1.626Z" />
                    </svg>
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <h1 className="wallet-adapter-modal-title">
                  You'll need a wallet on Solana to continue
                </h1>
                <div className="wallet-adapter-modal-middle">
                  <svg width="97" height="96" viewBox="0 0 97 96" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="48.5" cy="48" r="48" fill="url(#paint0_linear_wallet)" fillOpacity="0.1" />
                    <circle cx="48.5" cy="48" r="47" stroke="url(#paint1_linear_wallet)" strokeOpacity="0.4" strokeWidth="2" />
                    <defs>
                      <linearGradient id="paint0_linear_wallet" x1="3.42" y1="98.09" x2="103.05" y2="8.42" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#9945FF" /><stop offset="1" stopColor="#00D18C" />
                      </linearGradient>
                      <linearGradient id="paint1_linear_wallet" x1="3.42" y1="98.09" x2="103.05" y2="8.42" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#9945FF" /><stop offset="1" stopColor="#00D18C" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
                {collapsedWallets.length ? (
                  <>
                    <button
                      className="wallet-adapter-modal-list-more"
                      onClick={handleCollapseClick}
                      tabIndex={0}
                      type="button"
                    >
                      <span>
                        {expanded ? 'Hide ' : 'Already have a wallet? View '}
                        options
                      </span>
                      <svg width="13" height="7" viewBox="0 0 13 7" xmlns="http://www.w3.org/2000/svg"
                        className={expanded ? 'wallet-adapter-modal-list-more-icon-rotate' : ''}>
                        <path d="M0.71418 1.626L5.83323 6.26188C5.91574 6.33657 6.0181 6.39652 6.13327 6.43762C6.24844 6.47872 6.37371 6.5 6.50048 6.5C6.62725 6.5 6.75252 6.47872 6.8677 6.43762C6.98287 6.39652 7.08523 6.33657 7.16774 6.26188L12.2868 1.626C12.7753 1.1835 12.3703 0.5 11.6195 0.5H1.37997C0.629216 0.5 0.224175 1.1835 0.71418 1.626Z" />
                      </svg>
                    </button>
                    <div
                      className="wallet-adapter-collapse"
                      id="wallet-adapter-modal-collapse"
                      role="region"
                      style={{
                        height: expanded ? 'auto' : 0,
                        overflow: expanded ? 'initial' : 'hidden',
                        transition: 'height 250ms ease-out',
                      }}
                    >
                      <ul className="wallet-adapter-modal-list">
                        {collapsedWallets.map((wallet, index) => (
                          <li key={`${wallet.adapter.name}-${index}`}>
                            <button
                              className="wallet-adapter-button"
                              type="button"
                              tabIndex={expanded ? 0 : -1}
                              onClick={(event) =>
                                handleWalletClick(event, wallet.adapter.name)
                              }
                            >
                              <i className="wallet-adapter-button-start-icon">
                                <WalletIcon wallet={wallet} />
                              </i>
                              {wallet.adapter.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div
          className="wallet-adapter-modal-overlay"
          onMouseDown={handleClose}
          role="presentation"
        />
      </div>,
      portal
    )
  );
};
