use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("FoUdTt3bhy7JrKqFk9Uqg6vJVa4MFqRe4PTwRgxWQggB");

// ─── Constants ───────────────────────────────────────────────────────────────

pub const MAX_BUY_ORDERS: usize = 16;
pub const MAX_SELL_ORDERS: usize = 16;
pub const MAX_POSITIONS: usize = 32;
pub const MAX_TRADES: usize = 32;
pub const PRICE_PRECISION: u64 = 10_000;
pub const USDC_UNIT: u64 = 1_000_000; // 1 USDC = 1_000_000 (6 decimals)
pub const MAX_LEVERAGE: u8 = 10;

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum ClobError {
    #[msg("Price must be between 1 and 9999")]
    InvalidPrice,
    #[msg("Quantity must be greater than 0")]
    InvalidQty,
    #[msg("Collateral amount too small")]
    CollateralTooSmall,
    #[msg("Order is not active")]
    OrderNotActive,
    #[msg("Not the order owner")]
    NotOrderOwner,
    #[msg("Buy order book is full (max 16)")]
    BuyOrderBookFull,
    #[msg("Sell order book is full (max 16)")]
    SellOrderBookFull,
    #[msg("Too many positions (max 32 unique traders)")]
    TooManyPositions,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Order not found")]
    OrderNotFound,
    #[msg("No credits to settle")]
    NoCredits,
    #[msg("Leverage must be between 1 and 10")]
    InvalidLeverage,
}

// ─── Data structures ─────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct Order {
    pub id: u64,           // 8
    pub trader: Pubkey,    // 32
    pub is_buy: bool,      // 1
    pub price: u64,        // 8  (basis points, 1–9999)
    pub quantity: u64,     // 8  (shares)
    pub filled: u64,       // 8
    pub locked_usdc: u64,  // 8  (initial margin locked)
    pub timestamp: i64,    // 8
    pub active: bool,      // 1
    pub leverage: u8,      // 1  (1 = no leverage, 2..=10 = leveraged)
} // Total: 83 bytes

impl Order {
    pub const LEN: usize = 8 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct Trade {
    pub buy_order_id: u64,  // 8
    pub sell_order_id: u64, // 8
    pub buyer: Pubkey,      // 32
    pub seller: Pubkey,     // 32
    pub price: u64,         // 8
    pub quantity: u64,      // 8
    pub timestamp: i64,     // 8
} // Total: 104 bytes

impl Trade {
    pub const LEN: usize = 8 + 8 + 32 + 32 + 8 + 8 + 8;
}

// Tracks pending position credits for each trader.
// Call `settle` to mint SPL tokens and claim USDC refunds.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct UserPosition {
    pub trader: Pubkey,     // 32
    pub long_amount: u64,   // 8  – LONG tokens owed
    pub short_amount: u64,  // 8  – SHORT tokens owed
    pub usdc_credit: u64,   // 8  – USDC refund owed
    pub active: bool,       // 1
} // Total: 57 bytes

impl UserPosition {
    pub const LEN: usize = 32 + 8 + 8 + 8 + 1;
}

// ─── Account: OrderBook ──────────────────────────────────────────────────────

#[account]
pub struct OrderBook {
    pub authority: Pubkey,                  // 32
    pub usdc_mint: Pubkey,                  // 32
    pub long_mint: Pubkey,                  // 32
    pub short_mint: Pubkey,                 // 32
    pub symbol: String,                     // 4 + 32 max
    pub next_order_id: u64,                 // 8
    pub bump: u8,                           // 1
    pub long_mint_bump: u8,                 // 1
    pub short_mint_bump: u8,                // 1
    pub vault_bump: u8,                     // 1
    pub buy_orders: Vec<Order>,             // 4 + MAX_BUY_ORDERS  * Order::LEN
    pub sell_orders: Vec<Order>,            // 4 + MAX_SELL_ORDERS * Order::LEN
    pub user_positions: Vec<UserPosition>,  // 4 + MAX_POSITIONS   * UserPosition::LEN
    pub trade_history: Vec<Trade>,          // 4 + MAX_TRADES      * Trade::LEN
}

impl OrderBook {
    pub const SPACE: usize = 8                               // discriminator
        + 32 + 32 + 32 + 32                                  // pubkeys
        + (4 + 32)                                            // symbol (max 32 chars)
        + 8                                                   // next_order_id
        + 1 + 1 + 1 + 1                                      // bumps
        + (4 + MAX_BUY_ORDERS  * Order::LEN)
        + (4 + MAX_SELL_ORDERS * Order::LEN)
        + (4 + MAX_POSITIONS   * UserPosition::LEN)
        + (4 + MAX_TRADES      * Trade::LEN);
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct OrderPlaced {
    pub order_id: u64,
    pub trader: Pubkey,
    pub is_buy: bool,
    pub price: u64,
    pub quantity: u64,
    pub timestamp: i64,
}

#[event]
pub struct OrderCancelled {
    pub order_id: u64,
    pub trader: Pubkey,
    pub refund_amount: u64,
}

#[event]
pub struct OrderMatched {
    pub buy_order_id: u64,
    pub sell_order_id: u64,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub quantity: u64,
    pub timestamp: i64,
}

// ─── Account contexts ────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = OrderBook::SPACE,
        seeds = [b"orderbook"],
        bump,
    )]
    pub order_book: Account<'info, OrderBook>,

    #[account(
        init,
        payer = authority,
        seeds = [b"long_mint", order_book.key().as_ref()],
        bump,
        mint::decimals = 0,
        mint::authority = order_book,
        mint::freeze_authority = order_book,
    )]
    pub long_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        seeds = [b"short_mint", order_book.key().as_ref()],
        bump,
        mint::decimals = 0,
        mint::authority = order_book,
        mint::freeze_authority = order_book,
    )]
    pub short_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        seeds = [b"vault", order_book.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = order_book,
    )]
    pub usdc_vault: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct PlaceOrder<'info> {
    #[account(
        mut,
        seeds = [b"orderbook"],
        bump = order_book.bump,
    )]
    pub order_book: Account<'info, OrderBook>,

    #[account(
        mut,
        seeds = [b"vault", order_book.key().as_ref()],
        bump = order_book.vault_bump,
        token::mint = order_book.usdc_mint,
        token::authority = order_book,
    )]
    pub usdc_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_usdc: Account<'info, TokenAccount>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(
        mut,
        seeds = [b"orderbook"],
        bump = order_book.bump,
    )]
    pub order_book: Account<'info, OrderBook>,

    #[account(
        mut,
        seeds = [b"vault", order_book.key().as_ref()],
        bump = order_book.vault_bump,
        token::mint = order_book.usdc_mint,
        token::authority = order_book,
    )]
    pub usdc_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_usdc: Account<'info, TokenAccount>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        mut,
        seeds = [b"orderbook"],
        bump = order_book.bump,
    )]
    pub order_book: Account<'info, OrderBook>,

    #[account(
        mut,
        seeds = [b"vault", order_book.key().as_ref()],
        bump = order_book.vault_bump,
        token::mint = order_book.usdc_mint,
        token::authority = order_book,
    )]
    pub usdc_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"long_mint", order_book.key().as_ref()],
        bump = order_book.long_mint_bump,
    )]
    pub long_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"short_mint", order_book.key().as_ref()],
        bump = order_book.short_mint_bump,
    )]
    pub short_mint: Account<'info, Mint>,

    /// User's USDC token account to receive refunds
    #[account(mut)]
    pub user_usdc: Account<'info, TokenAccount>,

    /// User's LONG token account to receive minted position tokens
    #[account(mut)]
    pub user_long: Account<'info, TokenAccount>,

    /// User's SHORT token account to receive minted position tokens
    #[account(mut)]
    pub user_short: Account<'info, TokenAccount>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

// ─── Internal helpers ────────────────────────────────────────────────────────

fn calc_collateral(is_buy: bool, price: u64, qty: u64) -> Result<u64> {
    if is_buy {
        let v = (price as u128)
            .checked_mul(qty as u128)
            .and_then(|x| x.checked_mul(USDC_UNIT as u128))
            .and_then(|x| x.checked_div(PRICE_PRECISION as u128))
            .ok_or(error!(ClobError::Overflow))?;
        Ok(v as u64)
    } else {
        let v = (PRICE_PRECISION - price) as u128
            * qty as u128
            * USDC_UNIT as u128
            / PRICE_PRECISION as u128;
        Ok(v as u64)
    }
}

fn credit_position(
    ob: &mut OrderBook,
    trader: Pubkey,
    long: u64,
    short: u64,
    usdc: u64,
) -> Result<()> {
    if let Some(pos) = ob.user_positions.iter_mut().find(|p| p.active && p.trader == trader) {
        pos.long_amount = pos.long_amount.checked_add(long).ok_or(error!(ClobError::Overflow))?;
        pos.short_amount = pos.short_amount.checked_add(short).ok_or(error!(ClobError::Overflow))?;
        pos.usdc_credit = pos.usdc_credit.checked_add(usdc).ok_or(error!(ClobError::Overflow))?;
    } else {
        require!(ob.user_positions.len() < MAX_POSITIONS, ClobError::TooManyPositions);
        ob.user_positions.push(UserPosition {
            trader,
            long_amount: long,
            short_amount: short,
            usdc_credit: usdc,
            active: true,
        });
    }
    Ok(())
}

/// Execute a match between buy_orders[buy_idx] and sell_orders[sell_idx].
/// exec_price is sell.price for match_buy, buy.price for match_sell.
fn execute_match(
    ob: &mut OrderBook,
    buy_idx: usize,
    sell_idx: usize,
    exec_price: u64,
    match_qty: u64,
) -> Result<()> {
    let buy_price = ob.buy_orders[buy_idx].price;
    let sell_price = ob.sell_orders[sell_idx].price;

    ob.buy_orders[buy_idx].filled += match_qty;
    ob.sell_orders[sell_idx].filled += match_qty;

    // Buyer reserved at buy.price, pays exec_price → refund capped at user's margin
    let buy_lev = ob.buy_orders[buy_idx].leverage.max(1) as u64;
    let buy_reserved = (buy_price as u128 * match_qty as u128 * USDC_UNIT as u128
        / PRICE_PRECISION as u128) as u64;
    let buy_actual = (exec_price as u128 * match_qty as u128 * USDC_UNIT as u128
        / PRICE_PRECISION as u128) as u64;
    // Cap refund at user's actual margin contribution (individual margin, no pool)
    let buy_refund = buy_reserved.saturating_sub(buy_actual).min(buy_reserved / buy_lev);

    // Seller reserved at (1 - sell.price), refund capped at user's margin
    let sell_lev = ob.sell_orders[sell_idx].leverage.max(1) as u64;
    let sell_reserved = ((PRICE_PRECISION - sell_price) as u128
        * match_qty as u128 * USDC_UNIT as u128
        / PRICE_PRECISION as u128) as u64;
    let sell_actual = ((PRICE_PRECISION - exec_price) as u128
        * match_qty as u128 * USDC_UNIT as u128
        / PRICE_PRECISION as u128) as u64;
    // Cap refund at user's actual margin contribution (individual margin, no pool)
    let sell_refund = sell_reserved.saturating_sub(sell_actual).min(sell_reserved / sell_lev);

    ob.buy_orders[buy_idx].locked_usdc =
        ob.buy_orders[buy_idx].locked_usdc.saturating_sub(buy_reserved / buy_lev);
    ob.sell_orders[sell_idx].locked_usdc =
        ob.sell_orders[sell_idx].locked_usdc.saturating_sub(sell_reserved / sell_lev);

    // Mark fully-filled orders inactive
    if ob.buy_orders[buy_idx].filled >= ob.buy_orders[buy_idx].quantity {
        ob.buy_orders[buy_idx].active = false;
    }
    if ob.sell_orders[sell_idx].filled >= ob.sell_orders[sell_idx].quantity {
        ob.sell_orders[sell_idx].active = false;
    }

    let buy_trader = ob.buy_orders[buy_idx].trader;
    let sell_trader = ob.sell_orders[sell_idx].trader;
    let buy_id = ob.buy_orders[buy_idx].id;
    let sell_id = ob.sell_orders[sell_idx].id;

    // Credit pending position tokens + USDC refunds (claimed via settle)
    credit_position(ob, buy_trader, match_qty, 0, buy_refund)?;
    credit_position(ob, sell_trader, 0, match_qty, sell_refund)?;

    // Append to trade history (rotate if full)
    let clock = Clock::get()?;
    if ob.trade_history.len() >= MAX_TRADES {
        ob.trade_history.remove(0);
    }
    ob.trade_history.push(Trade {
        buy_order_id: buy_id,
        sell_order_id: sell_id,
        buyer: buy_trader,
        seller: sell_trader,
        price: exec_price,
        quantity: match_qty,
        timestamp: clock.unix_timestamp,
    });

    emit!(OrderMatched {
        buy_order_id: buy_id,
        sell_order_id: sell_id,
        buyer: buy_trader,
        seller: sell_trader,
        price: exec_price,
        quantity: match_qty,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

/// Try to fill new buy order at buy_orders[buy_idx] against resting sell orders.
/// Execution price is the sell order's price (price improvement for buyer).
fn match_buy(ob: &mut OrderBook, buy_idx: usize) -> Result<()> {
    loop {
        let (buy_filled, buy_qty, buy_price, buy_active) = {
            let b = &ob.buy_orders[buy_idx];
            (b.filled, b.quantity, b.price, b.active)
        };
        if !buy_active || buy_filled >= buy_qty {
            break;
        }

        // Best sell: lowest ask ≤ buy_price, tie-break earliest timestamp
        let best_sell = {
            let mut best_p = u64::MAX;
            let mut best_ts = i64::MAX;
            let mut best_i: Option<usize> = None;
            for (i, s) in ob.sell_orders.iter().enumerate() {
                if s.active && s.filled < s.quantity && s.price <= buy_price {
                    if s.price < best_p || (s.price == best_p && s.timestamp < best_ts) {
                        best_p = s.price;
                        best_ts = s.timestamp;
                        best_i = Some(i);
                    }
                }
            }
            best_i
        };

        match best_sell {
            None => break,
            Some(sell_idx) => {
                let exec_price = ob.sell_orders[sell_idx].price;
                let buy_rem = ob.buy_orders[buy_idx].quantity - ob.buy_orders[buy_idx].filled;
                let sell_rem = ob.sell_orders[sell_idx].quantity - ob.sell_orders[sell_idx].filled;
                let qty = buy_rem.min(sell_rem);
                execute_match(ob, buy_idx, sell_idx, exec_price, qty)?;

                // Remove fully-filled sell from book
                if !ob.sell_orders[sell_idx].active {
                    ob.sell_orders.swap_remove(sell_idx);
                }
            }
        }
    }
    if ob.buy_orders[buy_idx].filled >= ob.buy_orders[buy_idx].quantity {
        ob.buy_orders[buy_idx].active = false;
    }
    Ok(())
}

/// Try to fill new sell order at sell_orders[sell_idx] against resting buy orders.
/// Execution price is the buy order's price (price improvement for seller).
fn match_sell(ob: &mut OrderBook, sell_idx: usize) -> Result<()> {
    loop {
        let (sell_filled, sell_qty, sell_price, sell_active) = {
            let s = &ob.sell_orders[sell_idx];
            (s.filled, s.quantity, s.price, s.active)
        };
        if !sell_active || sell_filled >= sell_qty {
            break;
        }

        // Best buy: highest bid ≥ sell_price, tie-break earliest timestamp
        let best_buy = {
            let mut best_p: u64 = 0;
            let mut best_ts = i64::MAX;
            let mut best_i: Option<usize> = None;
            for (i, b) in ob.buy_orders.iter().enumerate() {
                if b.active && b.filled < b.quantity && b.price >= sell_price {
                    if b.price > best_p || (b.price == best_p && b.timestamp < best_ts) {
                        best_p = b.price;
                        best_ts = b.timestamp;
                        best_i = Some(i);
                    }
                }
            }
            best_i
        };

        match best_buy {
            None => break,
            Some(buy_idx) => {
                let exec_price = ob.buy_orders[buy_idx].price;
                let sell_rem = ob.sell_orders[sell_idx].quantity - ob.sell_orders[sell_idx].filled;
                let buy_rem = ob.buy_orders[buy_idx].quantity - ob.buy_orders[buy_idx].filled;
                let qty = sell_rem.min(buy_rem);
                execute_match(ob, buy_idx, sell_idx, exec_price, qty)?;

                // Remove fully-filled buy from book
                if !ob.buy_orders[buy_idx].active {
                    ob.buy_orders.swap_remove(buy_idx);
                    // sell_idx is unaffected (we only removed from buy_orders)
                }
            }
        }
    }
    if ob.sell_orders[sell_idx].filled >= ob.sell_orders[sell_idx].quantity {
        ob.sell_orders[sell_idx].active = false;
    }
    Ok(())
}

// ─── Program ─────────────────────────────────────────────────────────────────

#[program]
pub mod clob {
    use super::*;

    /// Initialize the order book, creating LONG/SHORT mints and a USDC vault.
    pub fn initialize(ctx: Context<Initialize>, symbol: String) -> Result<()> {
        let ob = &mut ctx.accounts.order_book;
        ob.authority = ctx.accounts.authority.key();
        ob.usdc_mint = ctx.accounts.usdc_mint.key();
        ob.long_mint = ctx.accounts.long_mint.key();
        ob.short_mint = ctx.accounts.short_mint.key();
        ob.symbol = symbol;
        ob.next_order_id = 1;
        ob.bump = ctx.bumps.order_book;
        ob.long_mint_bump = ctx.bumps.long_mint;
        ob.short_mint_bump = ctx.bumps.short_mint;
        ob.vault_bump = ctx.bumps.usdc_vault;
        ob.buy_orders = Vec::new();
        ob.sell_orders = Vec::new();
        ob.user_positions = Vec::new();
        ob.trade_history = Vec::new();
        msg!("CLOB initialized: symbol={}", ob.symbol);
        Ok(())
    }

    /// Place a resting limit order. Automatically matches against the book.
    /// Unmatched remainder rests on the book until cancelled.
    /// Each user posts their own initial margin = notional / leverage.
    /// No shared pool required — individual margin model.
    pub fn place_limit_order(
        ctx: Context<PlaceOrder>,
        is_buy: bool,
        price: u64,
        qty: u64,
        leverage: u8,
    ) -> Result<()> {
        require!(price > 0 && price < PRICE_PRECISION, ClobError::InvalidPrice);
        require!(qty > 0, ClobError::InvalidQty);
        require!(
            leverage >= 1 && leverage <= MAX_LEVERAGE,
            ClobError::InvalidLeverage
        );

        let notional = calc_collateral(is_buy, price, qty)?;
        require!(notional > 0, ClobError::CollateralTooSmall);

        // User posts only their initial margin (notional / leverage)
        let margin = notional / (leverage as u64);
        require!(margin > 0, ClobError::CollateralTooSmall);

        // Transfer user's individual margin to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_usdc.to_account_info(),
                    to: ctx.accounts.usdc_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            margin,
        )?;

        let clock = Clock::get()?;
        let trader = ctx.accounts.user.key();
        let timestamp = clock.unix_timestamp;
        let lev = leverage.max(1);

        let ob = &mut ctx.accounts.order_book;
        let id = ob.next_order_id;
        ob.next_order_id += 1;

        if is_buy {
            require!(ob.buy_orders.len() < MAX_BUY_ORDERS, ClobError::BuyOrderBookFull);
            ob.buy_orders.push(Order {
                id,
                trader,
                is_buy: true,
                price,
                quantity: qty,
                filled: 0,
                locked_usdc: margin,
                timestamp,
                active: true,
                leverage: lev,
            });
            let idx = ob.buy_orders.len() - 1;
            match_buy(ob, idx)?;
            if !ob.buy_orders[idx].active {
                ob.buy_orders.swap_remove(idx);
            }
        } else {
            require!(ob.sell_orders.len() < MAX_SELL_ORDERS, ClobError::SellOrderBookFull);
            ob.sell_orders.push(Order {
                id,
                trader,
                is_buy: false,
                price,
                quantity: qty,
                filled: 0,
                locked_usdc: margin,
                timestamp,
                active: true,
                leverage: lev,
            });
            let idx = ob.sell_orders.len() - 1;
            match_sell(ob, idx)?;
            if !ob.sell_orders[idx].active {
                ob.sell_orders.swap_remove(idx);
            }
        }

        emit!(OrderPlaced { order_id: id, trader, is_buy, price, quantity: qty, timestamp });
        Ok(())
    }

    /// Place an IOC market order. Matches immediately; unfilled portion is refunded.
    /// Each user posts their own initial margin = notional / leverage.
    pub fn place_market_order(
        ctx: Context<PlaceOrder>,
        is_buy: bool,
        qty: u64,
        leverage: u8,
    ) -> Result<()> {
        require!(qty > 0, ClobError::InvalidQty);
        require!(
            leverage >= 1 && leverage <= MAX_LEVERAGE,
            ClobError::InvalidLeverage
        );

        let worst_price = if is_buy { PRICE_PRECISION - 1 } else { 1 };
        let notional = calc_collateral(is_buy, worst_price, qty)?;
        require!(notional > 0, ClobError::CollateralTooSmall);

        // User posts only their initial margin (notional / leverage)
        let margin = notional / (leverage as u64);
        require!(margin > 0, ClobError::CollateralTooSmall);

        // Transfer user's individual margin to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_usdc.to_account_info(),
                    to: ctx.accounts.usdc_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            margin,
        )?;

        let clock = Clock::get()?;
        let trader = ctx.accounts.user.key();
        let timestamp = clock.unix_timestamp;
        let lev = leverage.max(1);

        let ob = &mut ctx.accounts.order_book;
        let id = ob.next_order_id;
        ob.next_order_id += 1;

        if is_buy {
            require!(ob.buy_orders.len() < MAX_BUY_ORDERS, ClobError::BuyOrderBookFull);
            ob.buy_orders.push(Order {
                id,
                trader,
                is_buy: true,
                price: worst_price,
                quantity: qty,
                filled: 0,
                locked_usdc: margin,
                timestamp,
                active: true,
                leverage: lev,
            });
            let idx = ob.buy_orders.len() - 1;
            match_buy(ob, idx)?;

            let unfilled = ob.buy_orders[idx].quantity - ob.buy_orders[idx].filled;
            if unfilled > 0 {
                let unfilled_notional = calc_collateral(true, worst_price, unfilled)?;
                let refund_margin = unfilled_notional
                    .checked_div(lev as u64)
                    .unwrap_or(0)
                    .min(ob.buy_orders[idx].locked_usdc);
                ob.buy_orders[idx].locked_usdc -= refund_margin;
                ob.buy_orders[idx].active = false;
                credit_position(ob, trader, 0, 0, refund_margin)?;
            }
            ob.buy_orders.swap_remove(idx);
        } else {
            require!(ob.sell_orders.len() < MAX_SELL_ORDERS, ClobError::SellOrderBookFull);
            ob.sell_orders.push(Order {
                id,
                trader,
                is_buy: false,
                price: worst_price,
                quantity: qty,
                filled: 0,
                locked_usdc: margin,
                timestamp,
                active: true,
                leverage: lev,
            });
            let idx = ob.sell_orders.len() - 1;
            match_sell(ob, idx)?;

            let unfilled = ob.sell_orders[idx].quantity - ob.sell_orders[idx].filled;
            if unfilled > 0 {
                let unfilled_notional = calc_collateral(false, worst_price, unfilled)?;
                let refund_margin = unfilled_notional
                    .checked_div(lev as u64)
                    .unwrap_or(0)
                    .min(ob.sell_orders[idx].locked_usdc);
                ob.sell_orders[idx].locked_usdc -= refund_margin;
                ob.sell_orders[idx].active = false;
                credit_position(ob, trader, 0, 0, refund_margin)?;
            }
            ob.sell_orders.swap_remove(idx);
        }

        emit!(OrderPlaced {
            order_id: id,
            trader,
            is_buy,
            price: worst_price,
            quantity: qty,
            timestamp,
        });
        Ok(())
    }

    /// Cancel a resting limit order and reclaim individual margin immediately.
    pub fn cancel_order(ctx: Context<CancelOrder>, order_id: u64) -> Result<()> {
        let user = ctx.accounts.user.key();
        let bump = ctx.accounts.order_book.bump;

        let refund_user = {
            let ob = &mut ctx.accounts.order_book;

            if let Some(idx) = ob.buy_orders.iter().position(|o| o.id == order_id) {
                let (active, trader, price, qty, filled, locked, leverage) = {
                    let o = &ob.buy_orders[idx];
                    (o.active, o.trader, o.price, o.quantity, o.filled, o.locked_usdc, o.leverage.max(1))
                };
                require!(active, ClobError::OrderNotActive);
                require!(trader == user, ClobError::NotOrderOwner);
                let unfilled = qty - filled;
                let unfilled_notional = calc_collateral(true, price, unfilled)?;
                let refund = unfilled_notional
                    .checked_div(leverage as u64)
                    .unwrap_or(0)
                    .min(locked);
                ob.buy_orders.swap_remove(idx);
                refund
            } else if let Some(idx) = ob.sell_orders.iter().position(|o| o.id == order_id) {
                let (active, trader, price, qty, filled, locked, leverage) = {
                    let o = &ob.sell_orders[idx];
                    (o.active, o.trader, o.price, o.quantity, o.filled, o.locked_usdc, o.leverage.max(1))
                };
                require!(active, ClobError::OrderNotActive);
                require!(trader == user, ClobError::NotOrderOwner);
                let unfilled = qty - filled;
                let unfilled_notional = calc_collateral(false, price, unfilled)?;
                let refund = unfilled_notional
                    .checked_div(leverage as u64)
                    .unwrap_or(0)
                    .min(locked);
                ob.sell_orders.swap_remove(idx);
                refund
            } else {
                return err!(ClobError::OrderNotFound);
            }
        };

        let seeds = &[b"orderbook".as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];

        if refund_user > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.usdc_vault.to_account_info(),
                        to: ctx.accounts.user_usdc.to_account_info(),
                        authority: ctx.accounts.order_book.to_account_info(),
                    },
                    signer_seeds,
                ),
                refund_user,
            )?;
        }

        emit!(OrderCancelled {
            order_id,
            trader: user,
            refund_amount: refund_user,
        });
        Ok(())
    }

    /// Claim pending position tokens (LONG/SHORT) and USDC refunds accumulated
    /// from order matches. Must be called after a successful match.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let user = ctx.accounts.user.key();
        let bump = ctx.accounts.order_book.bump;

        let (long_amount, short_amount, usdc_credit) = {
            let ob = &mut ctx.accounts.order_book;
            let pos = ob
                .user_positions
                .iter_mut()
                .find(|p| p.active && p.trader == user)
                .ok_or(error!(ClobError::OrderNotFound))?;

            require!(
                pos.long_amount > 0 || pos.short_amount > 0 || pos.usdc_credit > 0,
                ClobError::NoCredits
            );

            let vals = (pos.long_amount, pos.short_amount, pos.usdc_credit);
            pos.long_amount = 0;
            pos.short_amount = 0;
            pos.usdc_credit = 0;
            pos.active = false;
            vals
        };

        let seeds = &[b"orderbook".as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];

        // Return USDC refund (price improvement + unfilled IOC)
        if usdc_credit > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.usdc_vault.to_account_info(),
                        to: ctx.accounts.user_usdc.to_account_info(),
                        authority: ctx.accounts.order_book.to_account_info(),
                    },
                    signer_seeds,
                ),
                usdc_credit,
            )?;
        }

        // Mint LONG position tokens
        if long_amount > 0 {
            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.long_mint.to_account_info(),
                        to: ctx.accounts.user_long.to_account_info(),
                        authority: ctx.accounts.order_book.to_account_info(),
                    },
                    signer_seeds,
                ),
                long_amount,
            )?;
        }

        // Mint SHORT position tokens
        if short_amount > 0 {
            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.short_mint.to_account_info(),
                        to: ctx.accounts.user_short.to_account_info(),
                        authority: ctx.accounts.order_book.to_account_info(),
                    },
                    signer_seeds,
                ),
                short_amount,
            )?;
        }

        msg!(
            "Settled: long={} short={} usdc_refund={}",
            long_amount,
            short_amount,
            usdc_credit
        );
        Ok(())
    }
}
