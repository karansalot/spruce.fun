/**
 * Initialize the CLOB order book using the deployer keypair.
 * Uses KEYPAIR_PATH (default: deploy-testnet.json) which should be the keypair
 * for 6Cu2Uuctw13bdyEfcJnL1XYMPDYk6emBNtLAueu2bufL (has SOL for init).
 *
 * Prereqs: anchor build, keypair file present and funded.
 * Usage: KEYPAIR_PATH=./deploy-testnet.json yarn run initialize-orderbook
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Clob } from "../target/types/clob";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_KEYPAIR_PATH = "deploy-testnet.json";
const DEFAULT_RPC = "https://api.devnet.solana.com";
const DEFAULT_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const DEFAULT_SYMBOL = "FED-CHAIR";

async function main() {
  const clobDir = path.resolve(__dirname, "..");
  const keypairPath =
    process.env.KEYPAIR_PATH ||
    path.join(clobDir, DEFAULT_KEYPAIR_PATH);
  const keypairPathResolved = path.isAbsolute(keypairPath)
    ? keypairPath
    : path.join(clobDir, keypairPath);

  if (!fs.existsSync(keypairPathResolved)) {
    console.error(
      "Keypair file not found at",
      keypairPathResolved,
      "\nSet KEYPAIR_PATH or place deploy-testnet.json in the clob directory."
    );
    process.exit(1);
  }

  const keypairBytes = JSON.parse(
    fs.readFileSync(keypairPathResolved, "utf-8")
  ) as number[];
  const wallet = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(keypairBytes));

  const rpcUrl = process.env.RPC_URL || DEFAULT_RPC;
  const usdcMintStr = process.env.USDC_MINT || DEFAULT_USDC_MINT;
  const symbol = process.env.CLOB_SYMBOL || DEFAULT_SYMBOL;

  const connection = new anchor.web3.Connection(rpcUrl);
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const idlPath = path.join(clobDir, "target", "idl", "clob.json");
  if (!fs.existsSync(idlPath)) {
    console.error(
      "IDL not found. Run 'anchor build' from the clob directory first."
    );
    process.exit(1);
  }

  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  if (process.env.CLOB_PROGRAM_ID) {
    idl.address = process.env.CLOB_PROGRAM_ID;
  }
  const program = new Program(idl, provider) as Program<Clob>;
  const usdcMint = new anchor.web3.PublicKey(usdcMintStr);

  const [orderBookPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("orderbook")],
    program.programId
  );
  const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), orderBookPda.toBuffer()],
    program.programId
  );
  const [longMintPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("long_mint"), orderBookPda.toBuffer()],
    program.programId
  );
  const [shortMintPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("short_mint"), orderBookPda.toBuffer()],
    program.programId
  );

  const accountInfo = await connection.getAccountInfo(orderBookPda);
  if (accountInfo) {
    console.log("Order book already initialized at", orderBookPda.toBase58());
    const ob = await program.account.orderBook.fetch(orderBookPda);
    console.log("  symbol:", ob.symbol);
    return;
  }

  console.log("Initializing order book...");
  console.log("  authority:", wallet.publicKey.toBase58());
  console.log("  symbol:", symbol);
  console.log("  usdcMint:", usdcMintStr);
  console.log("  orderBook PDA:", orderBookPda.toBase58());

  await program.methods
    .initialize(symbol)
    .accounts({
      orderBook: orderBookPda,
      longMint: longMintPda,
      shortMint: shortMintPda,
      usdcVault: vaultPda,
      usdcMint,
      authority: wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .rpc();

  console.log("Order book initialized successfully.");
  try {
    const ob = await program.account.orderBook.fetch(orderBookPda);
    console.log("  symbol:", ob.symbol);
    console.log("  nextOrderId:", ob.nextOrderId.toString());
  } catch (e) {
    console.log("  (account fetch skipped:", (e as Error).message + ")");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
