use chrono::Utc;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::errors::RiskError;
use crate::types::*;

#[derive(Clone)]
pub struct Database {
    pub pool: PgPool,
}

impl Database {
    pub async fn new(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = PgPool::connect(database_url).await?;
        Ok(Self { pool })
    }

    pub async fn initialize_schema(&self) -> Result<(), sqlx::Error> {
        let schema = include_str!("../schema.sql");
        sqlx::raw_sql(schema).execute(&self.pool).await?;
        Ok(())
    }

    // ── Margin Accounts ──

    pub async fn get_or_create_margin_account(&self, wallet: &str) -> Result<MarginAccount, RiskError> {
        let row = sqlx::query(
            r#"INSERT INTO margin_accounts (wallet, balance, locked_margin)
               VALUES ($1, 0, 0)
               ON CONFLICT (wallet) DO NOTHING
               RETURNING id, wallet, balance, locked_margin, updated_at"#,
        )
        .bind(wallet)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(row) = row {
            return Ok(MarginAccount {
                id: row.get("id"),
                wallet: row.get("wallet"),
                balance: row.get::<i64, _>("balance") as u64,
                locked_margin: row.get::<i64, _>("locked_margin") as u64,
                updated_at: row.get("updated_at"),
            });
        }

        // Already exists, fetch it
        self.get_margin_account(wallet).await
    }

    pub async fn get_margin_account(&self, wallet: &str) -> Result<MarginAccount, RiskError> {
        let row = sqlx::query(
            "SELECT id, wallet, balance, locked_margin, updated_at FROM margin_accounts WHERE wallet = $1",
        )
        .bind(wallet)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| RiskError::MarginAccountNotFound {
            wallet: wallet.to_string(),
        })?;

        Ok(MarginAccount {
            id: row.get("id"),
            wallet: row.get("wallet"),
            balance: row.get::<i64, _>("balance") as u64,
            locked_margin: row.get::<i64, _>("locked_margin") as u64,
            updated_at: row.get("updated_at"),
        })
    }

    pub async fn deposit_margin(&self, wallet: &str, amount: u64) -> Result<MarginAccount, RiskError> {
        let row = sqlx::query(
            r#"UPDATE margin_accounts
               SET balance = balance + $2, updated_at = now()
               WHERE wallet = $1
               RETURNING id, wallet, balance, locked_margin, updated_at"#,
        )
        .bind(wallet)
        .bind(amount as i64)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| RiskError::MarginAccountNotFound {
            wallet: wallet.to_string(),
        })?;

        Ok(MarginAccount {
            id: row.get("id"),
            wallet: row.get("wallet"),
            balance: row.get::<i64, _>("balance") as u64,
            locked_margin: row.get::<i64, _>("locked_margin") as u64,
            updated_at: row.get("updated_at"),
        })
    }

    pub async fn withdraw_margin(&self, wallet: &str, amount: u64) -> Result<MarginAccount, RiskError> {
        // Atomically check available = balance - locked >= amount
        let row = sqlx::query(
            r#"UPDATE margin_accounts
               SET balance = balance - $2, updated_at = now()
               WHERE wallet = $1 AND (balance - locked_margin) >= $2
               RETURNING id, wallet, balance, locked_margin, updated_at"#,
        )
        .bind(wallet)
        .bind(amount as i64)
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(row) => Ok(MarginAccount {
                id: row.get("id"),
                wallet: row.get("wallet"),
                balance: row.get::<i64, _>("balance") as u64,
                locked_margin: row.get::<i64, _>("locked_margin") as u64,
                updated_at: row.get("updated_at"),
            }),
            None => {
                let acct = self.get_margin_account(wallet).await?;
                Err(RiskError::InsufficientBalance {
                    requested: amount,
                    available: acct.available_balance(),
                })
            }
        }
    }

    // ── Margin Reservations (two-phase) ──

    /// Atomically reserve margin: deduct from available, add to locked, create reservation row.
    pub async fn reserve_margin(
        &self,
        wallet: &str,
        symbol: &str,
        side: PositionSide,
        size: u64,
        price: u64,
        leverage: f64,
        amount: u64,
    ) -> Result<MarginReservation, RiskError> {
        let mut tx = self.pool.begin().await?;

        // Lock the margin account row and check available balance
        let row = sqlx::query(
            r#"UPDATE margin_accounts
               SET locked_margin = locked_margin + $2, updated_at = now()
               WHERE wallet = $1 AND (balance - locked_margin) >= $2
               RETURNING id"#,
        )
        .bind(wallet)
        .bind(amount as i64)
        .fetch_optional(&mut *tx)
        .await?;

        if row.is_none() {
            tx.rollback().await.ok();
            let acct = self.get_margin_account(wallet).await?;
            return Err(RiskError::InsufficientMargin {
                required: amount,
                available: acct.available_balance(),
            });
        }

        let reservation_id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO margin_reservations (id, wallet, symbol, side, size, price, leverage, reserved_amount, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')"#,
        )
        .bind(reservation_id)
        .bind(wallet)
        .bind(symbol)
        .bind(side.as_str())
        .bind(size as i64)
        .bind(price as i64)
        .bind(leverage)
        .bind(amount as i64)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(MarginReservation {
            id: reservation_id,
            wallet: wallet.to_string(),
            symbol: symbol.to_string(),
            side,
            size,
            price,
            leverage,
            reserved_amount: amount,
            status: ReservationStatus::Active,
            created_at: Utc::now(),
        })
    }

    /// Commit a reservation: mark it committed (margin stays locked, transferred to position).
    pub async fn commit_reservation(&self, reservation_id: Uuid) -> Result<MarginReservation, RiskError> {
        let row = sqlx::query(
            r#"UPDATE margin_reservations
               SET status = 'committed'
               WHERE id = $1 AND status = 'active'
               RETURNING id, wallet, symbol, side, size, price, leverage, reserved_amount, status, created_at"#,
        )
        .bind(reservation_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| RiskError::Internal(format!("reservation {} not found or not active", reservation_id)))?;

        Ok(parse_reservation_row(&row))
    }

    /// Release a reservation: return locked margin to available.
    pub async fn release_reservation(&self, reservation_id: Uuid) -> Result<(), RiskError> {
        let mut tx = self.pool.begin().await?;

        let row = sqlx::query(
            r#"UPDATE margin_reservations
               SET status = 'released'
               WHERE id = $1 AND status = 'active'
               RETURNING wallet, reserved_amount"#,
        )
        .bind(reservation_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| RiskError::Internal(format!("reservation {} not found or not active", reservation_id)))?;

        let wallet: String = row.get("wallet");
        let amount: i64 = row.get("reserved_amount");

        sqlx::query(
            "UPDATE margin_accounts SET locked_margin = locked_margin - $2, updated_at = now() WHERE wallet = $1",
        )
        .bind(&wallet)
        .bind(amount)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    // ── Positions ──

    pub async fn get_open_position(
        &self,
        wallet: &str,
        symbol: &str,
        side: PositionSide,
    ) -> Result<Option<Position>, RiskError> {
        let row = sqlx::query(
            r#"SELECT id, wallet, symbol, side, size, entry_price, margin, leverage,
                      liquidation_price, status, created_at, updated_at
               FROM positions
               WHERE wallet = $1 AND symbol = $2 AND side = $3 AND status = 'open'"#,
        )
        .bind(wallet)
        .bind(symbol)
        .bind(side.as_str())
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| parse_position_row(&r)))
    }

    pub async fn get_open_positions_by_wallet(&self, wallet: &str) -> Result<Vec<Position>, RiskError> {
        let rows = sqlx::query(
            r#"SELECT id, wallet, symbol, side, size, entry_price, margin, leverage,
                      liquidation_price, status, created_at, updated_at
               FROM positions WHERE wallet = $1 AND status = 'open'
               ORDER BY created_at DESC"#,
        )
        .bind(wallet)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.iter().map(parse_position_row).collect())
    }

    pub async fn get_all_open_positions(&self) -> Result<Vec<Position>, RiskError> {
        let rows = sqlx::query(
            r#"SELECT id, wallet, symbol, side, size, entry_price, margin, leverage,
                      liquidation_price, status, created_at, updated_at
               FROM positions WHERE status = 'open'"#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.iter().map(parse_position_row).collect())
    }

    pub async fn get_open_positions_by_symbol(&self, symbol: &str) -> Result<Vec<Position>, RiskError> {
        let rows = sqlx::query(
            r#"SELECT id, wallet, symbol, side, size, entry_price, margin, leverage,
                      liquidation_price, status, created_at, updated_at
               FROM positions WHERE symbol = $1 AND status = 'open'"#,
        )
        .bind(symbol)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.iter().map(parse_position_row).collect())
    }

    pub async fn insert_position(&self, pos: &Position) -> Result<(), RiskError> {
        sqlx::query(
            r#"INSERT INTO positions (id, wallet, symbol, side, size, entry_price, margin, leverage, liquidation_price, status, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)"#,
        )
        .bind(pos.id)
        .bind(&pos.wallet)
        .bind(&pos.symbol)
        .bind(pos.side.as_str())
        .bind(pos.size as i64)
        .bind(pos.entry_price as i64)
        .bind(pos.margin as i64)
        .bind(pos.leverage)
        .bind(pos.liquidation_price as i64)
        .bind(pos.status.as_str())
        .bind(pos.created_at)
        .bind(pos.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_position(&self, pos: &Position) -> Result<(), RiskError> {
        sqlx::query(
            r#"UPDATE positions
               SET size = $2, entry_price = $3, margin = $4, leverage = $5,
                   liquidation_price = $6, status = $7, updated_at = now()
               WHERE id = $1"#,
        )
        .bind(pos.id)
        .bind(pos.size as i64)
        .bind(pos.entry_price as i64)
        .bind(pos.margin as i64)
        .bind(pos.leverage)
        .bind(pos.liquidation_price as i64)
        .bind(pos.status.as_str())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Reduce position size (partial liquidation). Updates margin proportionally.
    pub async fn reduce_position_size(&self, position_id: Uuid, close_size: u64) -> Result<Position, RiskError> {
        let row = sqlx::query(
            r#"UPDATE positions
               SET size = size - $2,
                   margin = (margin * (size - $2)) / size,
                   updated_at = now()
               WHERE id = $1 AND status = 'open' AND size >= $2
               RETURNING id, wallet, symbol, side, size, entry_price, margin, leverage,
                         liquidation_price, status, created_at, updated_at"#,
        )
        .bind(position_id)
        .bind(close_size as i64)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| RiskError::Internal(format!("position {} not found or insufficient size", position_id)))?;

        Ok(parse_position_row(&row))
    }

    pub async fn close_position(&self, position_id: Uuid, status: PositionStatus) -> Result<(), RiskError> {
        sqlx::query(
            "UPDATE positions SET status = $2, updated_at = now() WHERE id = $1",
        )
        .bind(position_id)
        .bind(status.as_str())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Unlock margin for a wallet (when closing a position).
    pub async fn unlock_margin(&self, wallet: &str, amount: u64) -> Result<(), RiskError> {
        sqlx::query(
            r#"UPDATE margin_accounts
               SET locked_margin = GREATEST(locked_margin - $2, 0), updated_at = now()
               WHERE wallet = $1"#,
        )
        .bind(wallet)
        .bind(amount as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Credit PnL to wallet balance (can be negative for losses).
    pub async fn credit_pnl(&self, wallet: &str, pnl: i64) -> Result<(), RiskError> {
        sqlx::query(
            r#"UPDATE margin_accounts
               SET balance = GREATEST(balance + $2, 0), updated_at = now()
               WHERE wallet = $1"#,
        )
        .bind(wallet)
        .bind(pnl)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ── Liquidation Events ──

    pub async fn insert_liquidation_event(
        &self,
        event: &LiquidationEvent,
        stage: &str,
    ) -> Result<(), RiskError> {
        sqlx::query(
            r#"INSERT INTO liquidation_events
               (id, position_id, wallet, symbol, side, stage, size, entry_price, mark_price, margin, pnl, insurance_fund_delta, liquidated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)"#,
        )
        .bind(event.id)
        .bind(event.position_id)
        .bind(&event.wallet)
        .bind(&event.symbol)
        .bind(event.side.as_str())
        .bind(stage)
        .bind(event.size as i64)
        .bind(event.entry_price as i64)
        .bind(event.mark_price as i64)
        .bind(event.margin as i64)
        .bind(event.pnl)
        .bind(event.insurance_fund_delta)
        .bind(event.liquidated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_liquidation_events_by_wallet(&self, wallet: &str) -> Result<Vec<LiquidationEvent>, RiskError> {
        let rows = sqlx::query(
            r#"SELECT id, position_id, wallet, symbol, side, size, entry_price, mark_price,
                      margin, pnl, insurance_fund_delta, liquidated_at
               FROM liquidation_events WHERE wallet = $1
               ORDER BY liquidated_at DESC"#,
        )
        .bind(wallet)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|r| LiquidationEvent {
                id: r.get("id"),
                position_id: r.get("position_id"),
                wallet: r.get("wallet"),
                symbol: r.get("symbol"),
                side: PositionSide::from_str_loose(r.get::<String, _>("side").as_str())
                    .unwrap_or(PositionSide::Long),
                size: r.get::<i64, _>("size") as u64,
                entry_price: r.get::<i64, _>("entry_price") as u64,
                mark_price: r.get::<i64, _>("mark_price") as u64,
                margin: r.get::<i64, _>("margin") as u64,
                pnl: r.get("pnl"),
                insurance_fund_delta: r.get("insurance_fund_delta"),
                liquidated_at: r.get("liquidated_at"),
            })
            .collect())
    }

    // ── Insurance Fund ──

    pub async fn get_insurance_fund_balance(&self) -> Result<u64, RiskError> {
        let row = sqlx::query("SELECT balance FROM insurance_fund LIMIT 1")
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|r| r.get::<i64, _>("balance") as u64).unwrap_or(0))
    }

    pub async fn update_insurance_fund(&self, delta: i64, reason: &str, position_id: Option<Uuid>) -> Result<u64, RiskError> {
        let mut tx = self.pool.begin().await?;

        let row = sqlx::query(
            r#"UPDATE insurance_fund
               SET balance = GREATEST(balance + $1, 0), updated_at = now()
               RETURNING balance"#,
        )
        .bind(delta)
        .fetch_one(&mut *tx)
        .await?;

        let new_balance = row.get::<i64, _>("balance") as u64;

        sqlx::query(
            "INSERT INTO insurance_fund_transactions (amount, reason, position_id) VALUES ($1, $2, $3)",
        )
        .bind(delta)
        .bind(reason)
        .bind(position_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(new_balance)
    }
}

// ── Row Parsers ──

fn parse_position_row(r: &sqlx::postgres::PgRow) -> Position {
    let side_str: String = r.get("side");
    let status_str: String = r.get("status");
    Position {
        id: r.get("id"),
        wallet: r.get("wallet"),
        symbol: r.get("symbol"),
        side: PositionSide::from_str_loose(&side_str).unwrap_or(PositionSide::Long),
        size: r.get::<i64, _>("size") as u64,
        entry_price: r.get::<i64, _>("entry_price") as u64,
        margin: r.get::<i64, _>("margin") as u64,
        leverage: r.get("leverage"),
        liquidation_price: r.get::<i64, _>("liquidation_price") as u64,
        status: match status_str.as_str() {
            "closed" => PositionStatus::Closed,
            "liquidated" => PositionStatus::Liquidated,
            _ => PositionStatus::Open,
        },
        created_at: r.get("created_at"),
        updated_at: r.get("updated_at"),
    }
}

fn parse_reservation_row(r: &sqlx::postgres::PgRow) -> MarginReservation {
    let side_str: String = r.get("side");
    let status_str: String = r.get("status");
    MarginReservation {
        id: r.get("id"),
        wallet: r.get("wallet"),
        symbol: r.get("symbol"),
        side: PositionSide::from_str_loose(&side_str).unwrap_or(PositionSide::Long),
        size: r.get::<i64, _>("size") as u64,
        price: r.get::<i64, _>("price") as u64,
        leverage: r.get("leverage"),
        reserved_amount: r.get::<i64, _>("reserved_amount") as u64,
        status: match status_str.as_str() {
            "committed" => ReservationStatus::Committed,
            "released" => ReservationStatus::Released,
            _ => ReservationStatus::Active,
        },
        created_at: r.get("created_at"),
    }
}
