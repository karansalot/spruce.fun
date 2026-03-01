import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import idl from './idl/clob.json';
import { CLOB_PROGRAM_ID, SOLANA_RPC } from './constants';

const PROGRAM_ID = new PublicKey(CLOB_PROGRAM_ID);
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSVAR_RENT_PUBKEY = new PublicKey('SysvarRent111111111111111111111111111111111');
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

export type OrderView = {
  id: bigint;
  trader: string;
  isBuy: boolean;
  price: bigint;
  remainingQty: bigint;
  timestamp: number;
};

export type TradeView = {
  buyOrderId: bigint;
  sellOrderId: bigint;
  buyer: string;
  seller: string;
  price: bigint;
  quantity: bigint;
  timestamp: number;
};

export function getConnection(): Connection {
  return new Connection(SOLANA_RPC);
}

export function getOrderBookPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('orderbook')],
    PROGRAM_ID
  );
  return pda;
}

export function getVaultPda(orderBookPda: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), orderBookPda.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function getLongMintPda(orderBookPda: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('long_mint'), orderBookPda.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function getShortMintPda(orderBookPda: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('short_mint'), orderBookPda.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function createProgram(connection: Connection, wallet: WalletContextState): Program | null {
  if (!wallet.publicKey) return null;
  const signTransaction = wallet.signTransaction;
  const signAllTransactions = wallet.signAllTransactions;
  if (!signTransaction || !signAllTransactions) return null;
  // AnchorProvider expects a wallet with .publicKey; adapters may expose it only on context.
  const walletWithPublicKey = {
    publicKey: wallet.publicKey,
    signTransaction: (tx: Parameters<typeof signTransaction>[0]) => signTransaction(tx),
    signAllTransactions: (txs: Parameters<typeof signAllTransactions>[0]) => signAllTransactions(txs),
  };
  const provider = new AnchorProvider(
    connection,
    walletWithPublicKey as any,
    { commitment: 'confirmed' }
  );
  return new Program(idl as any, provider);
}

/** Initialize the on-chain order book with a USDC mint and symbol. Requires wallet (payer). */
export async function initializeOrderBook(
  program: Program,
  usdcMint: PublicKey,
  symbol: string,
  authority: PublicKey
): Promise<string> {
  const orderBookPda = getOrderBookPda();
  const longMintPda = getLongMintPda(orderBookPda);
  const shortMintPda = getShortMintPda(orderBookPda);
  const vaultPda = getVaultPda(orderBookPda);

  const tx = await program.methods
    .initialize(symbol)
    .accounts({
      orderBook: orderBookPda,
      longMint: longMintPda,
      shortMint: shortMintPda,
      usdcVault: vaultPda,
      usdcMint: usdcMint,
      authority,
      systemProgram: SYSTEM_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    } as any)
    .rpc();
  return tx;
}

export async function fetchOrderBook(connection: Connection): Promise<{
  buyOrders: OrderView[];
  sellOrders: OrderView[];
  tradeHistory: TradeView[];
  initialized: boolean;
}> {
  const orderBookPda = getOrderBookPda();
  const accountInfo = await connection.getAccountInfo(orderBookPda);
  if (!accountInfo?.data) {
    return { buyOrders: [], sellOrders: [], tradeHistory: [], initialized: false };
  }
  const program = new Program(idl as any, { connection } as any);
  const orderBook = await (program.account as any).orderBook.fetch(orderBookPda).catch(() => null);
  if (!orderBook) {
    return { buyOrders: [], sellOrders: [], tradeHistory: [], initialized: false };
  }

  const toOrderView = (o: any): OrderView => ({
    id: BigInt(o.id.toString()),
    trader: o.trader.toBase58(),
    isBuy: o.isBuy,
    price: BigInt(o.price.toString()),
    remainingQty: BigInt((o.quantity - o.filled).toString()),
    timestamp: Number(o.timestamp),
  });

  const toTradeView = (t: any): TradeView => ({
    buyOrderId: BigInt(t.buyOrderId.toString()),
    sellOrderId: BigInt(t.sellOrderId.toString()),
    buyer: t.buyer.toBase58(),
    seller: t.seller.toBase58(),
    price: BigInt(t.price.toString()),
    quantity: BigInt(t.quantity.toString()),
    timestamp: Number(t.timestamp),
  });

  const buyOrders = (orderBook.buyOrders || [])
    .filter((o: any) => o.active && o.filled < o.quantity)
    .map(toOrderView);
  const sellOrders = (orderBook.sellOrders || [])
    .filter((o: any) => o.active && o.filled < o.quantity)
    .map(toOrderView);
  const tradeHistory = (orderBook.tradeHistory || []).map(toTradeView);

  return { buyOrders, sellOrders, tradeHistory, initialized: true };
}

export function fetchActiveBuyOrdersFromState(state: {
  buyOrders: OrderView[];
}): OrderView[] {
  return state.buyOrders;
}

export function fetchActiveSellOrdersFromState(state: {
  sellOrders: OrderView[];
}): OrderView[] {
  return state.sellOrders;
}

export function fetchUserActiveOrders(state: {
  buyOrders: OrderView[];
  sellOrders: OrderView[];
}, userPubkey: string): OrderView[] {
  const user = userPubkey;
  const fromBuy = state.buyOrders.filter((o) => o.trader === user);
  const fromSell = state.sellOrders.filter((o) => o.trader === user);
  return [...fromBuy, ...fromSell];
}

export async function placeLimitOrder(
  program: Program,
  userUsdc: PublicKey,
  isBuy: boolean,
  priceBp: bigint,
  qty: bigint,
  leverage: number = 1,
): Promise<string> {
  const orderBookPda = getOrderBookPda();
  const vaultPda = getVaultPda(orderBookPda);
  const tx = await program.methods
    .placeLimitOrder(isBuy, new BN(priceBp.toString()), new BN(qty.toString()), leverage)
    .accounts({
      orderBook: orderBookPda,
      usdcVault: vaultPda,
      userUsdc,
      user: (program.provider as AnchorProvider).publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .rpc();
  return tx;
}

export async function placeMarketOrder(
  program: Program,
  userUsdc: PublicKey,
  isBuy: boolean,
  qty: bigint,
  leverage: number = 1,
): Promise<string> {
  const orderBookPda = getOrderBookPda();
  const vaultPda = getVaultPda(orderBookPda);
  const tx = await program.methods
    .placeMarketOrder(isBuy, new BN(qty.toString()), leverage)
    .accounts({
      orderBook: orderBookPda,
      usdcVault: vaultPda,
      userUsdc,
      user: (program.provider as AnchorProvider).publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .rpc();
  return tx;
}

export async function cancelOrder(
  program: Program,
  userUsdc: PublicKey,
  orderId: bigint,
): Promise<string> {
  const orderBookPda = getOrderBookPda();
  const vaultPda = getVaultPda(orderBookPda);
  const tx = await program.methods
    .cancelOrder(new BN(orderId.toString()))
    .accounts({
      orderBook: orderBookPda,
      usdcVault: vaultPda,
      userUsdc,
      user: (program.provider as AnchorProvider).publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .rpc();
  return tx;
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 4)}..${addr.slice(-4)}`;
}

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function explorerAddressUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}
