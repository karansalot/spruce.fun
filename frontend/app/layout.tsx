import type { Metadata } from "next";
import "./globals.css";
import ThemeProvider from "./providers/ThemeProvider";
import PrivyProviderWrapper from "./providers/PrivyProvider";
import SolanaWalletProvider from "./providers/SolanaWalletProvider";

export const metadata: Metadata = {
  title: "Derive - On-Chain Trading",
  description: "Fully on-chain CLOB orderbook on Solana",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-white dark:bg-[#0f1115] text-gray-900 dark:text-[#e7e9ee]">
        <ThemeProvider>
          <PrivyProviderWrapper>
            <SolanaWalletProvider>
              {children}
            </SolanaWalletProvider>
          </PrivyProviderWrapper>
        </ThemeProvider>
      </body>
    </html>
  );
}
