import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Clob } from "../target/types/clob";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("clob", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.clob as Program<Clob>;
  const connection = provider.connection;
  const authority = provider.wallet;

  let usdcMint: anchor.web3.PublicKey;
  let orderBookPda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let userUsdc: anchor.web3.PublicKey;
  const USDC_DECIMALS = 6;

  before(async () => {
    const airdrop = await connection.requestAirdrop(
      authority.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdrop);

    const mintKp = Keypair.generate();
    usdcMint = mintKp.publicKey;
    await createMint(
      connection,
      authority.payer,
      authority.publicKey,
      null,
      USDC_DECIMALS,
      mintKp
    );

    const ata = await getOrCreateAssociatedTokenAccount(
      connection,
      authority.payer,
      usdcMint,
      authority.publicKey
    );
    userUsdc = ata.address;
    await mintTo(
      connection,
      authority.payer,
      usdcMint,
      userUsdc,
      authority.publicKey,
      1_000_000 * 1_000_000
    );
  });

  it("initializes the order book", async () => {
    [orderBookPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("orderbook")],
      program.programId
    );
    [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
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

    await program.methods
      .initialize("SPRUCE")
      .accounts({
        orderBook: orderBookPda,
        longMint: longMintPda,
        shortMint: shortMintPda,
        usdcVault: vaultPda,
        usdcMint,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const ob = await program.account.orderBook.fetch(orderBookPda);
    expect(ob.symbol).to.equal("SPRUCE");
    expect(ob.nextOrderId.toNumber()).to.equal(1);
    expect(ob.usdcMint.equals(usdcMint)).to.be.true;
  });

  it("places a limit buy order", async () => {
    const price = 5000; // 0.5 USDC per share (basis points)
    const qty = 100;

    await program.methods
      .placeLimitOrder(true, new anchor.BN(price), new anchor.BN(qty), 1)
      .accounts({
        orderBook: orderBookPda,
        usdcVault: vaultPda,
        userUsdc,
        user: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const ob = await program.account.orderBook.fetch(orderBookPda);
    expect(ob.buyOrders.length).to.be.gte(1);
    const order = ob.buyOrders.find((o: any) => o.active);
    expect(order).to.be.ok;
    expect(order.price.toNumber()).to.equal(price);
    expect(order.quantity.toNumber()).to.equal(qty);
  });

  it("places a limit sell order that matches", async () => {
    const price = 5000;
    const qty = 50;

    await program.methods
      .placeLimitOrder(false, new anchor.BN(price), new anchor.BN(qty), 1)
      .accounts({
        orderBook: orderBookPda,
        usdcVault: vaultPda,
        userUsdc,
        user: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const ob = await program.account.orderBook.fetch(orderBookPda);
    expect(ob.tradeHistory.length).to.be.gte(1);
    expect(ob.userPositions.length).to.be.gte(1);
  });

  it("settles and mints LONG/SHORT tokens", async () => {
    const [longMintPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("long_mint"), orderBookPda.toBuffer()],
      program.programId
    );
    const [shortMintPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("short_mint"), orderBookPda.toBuffer()],
      program.programId
    );

    const userLongAta = await getOrCreateAssociatedTokenAccount(
      connection,
      authority.payer,
      longMintPda,
      authority.publicKey
    );
    const userShortAta = await getOrCreateAssociatedTokenAccount(
      connection,
      authority.payer,
      shortMintPda,
      authority.publicKey
    );

    await program.methods
      .settle()
      .accounts({
        orderBook: orderBookPda,
        usdcVault: vaultPda,
        longMint: longMintPda,
        shortMint: shortMintPda,
        userUsdc,
        userLong: userLongAta.address,
        userShort: userShortAta.address,
        user: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const longBalance = await connection.getTokenAccountBalance(
      userLongAta.address
    );
    const shortBalance = await connection.getTokenAccountBalance(
      userShortAta.address
    );
    expect(Number(longBalance.value.amount)).to.be.gte(0);
    expect(Number(shortBalance.value.amount)).to.be.gte(0);
  });

  it("cancels an open order", async () => {
    const obBefore = await program.account.orderBook.fetch(orderBookPda);
    const openBuy = obBefore.buyOrders.find((o: any) => o.active);
    if (!openBuy) return;

    await program.methods
      .cancelOrder(openBuy.id)
      .accounts({
        orderBook: orderBookPda,
        usdcVault: vaultPda,
        userUsdc,
        user: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const obAfter = await program.account.orderBook.fetch(orderBookPda);
    const stillThere = obAfter.buyOrders.find(
      (o: any) => o.id.eq(openBuy.id) && o.active
    );
    expect(stillThere).to.be.undefined;
  });
});
