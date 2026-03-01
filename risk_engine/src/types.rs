use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Side of a position or order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PositionSide {
    Long,
    Short,
}

impl PositionSide {
    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "long" | "buy" | "bid" => Some(Self::Long),
            "short" | "sell" | "ask" => Some(Self::Short),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Long => "long",
            Self::Short => "short",
        }
    }
}

impl std::fmt::Display for PositionSide {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Status of a position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PositionStatus {
    Open,
    Closed,
    Liquidated,
}

impl PositionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Closed => "closed",
            Self::Liquidated => "liquidated",
        }
    }
}

/// An open (or historical) perpetual position.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: Uuid,
    pub wallet: String,
    pub symbol: String,
    pub side: PositionSide,
    /// Size in contracts (basis-point units).
    pub size: u64,
    /// Volume-weighted average entry price in basis points.
    pub entry_price: u64,
    /// Margin deposited for this position (basis points).
    pub margin: u64,
    /// Effective leverage used.
    pub leverage: f64,
    /// Pre-computed liquidation price (basis points).
    pub liquidation_price: u64,
    pub status: PositionStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Per-wallet margin account.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarginAccount {
    pub id: Uuid,
    pub wallet: String,
    /// Total deposited collateral in basis points.
    pub balance: u64,
    /// Collateral currently locked in open positions.
    pub locked_margin: u64,
    pub updated_at: DateTime<Utc>,
}

impl MarginAccount {
    pub fn available_balance(&self) -> u64 {
        self.balance.saturating_sub(self.locked_margin)
    }
}

/// Mark price for a symbol.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkPrice {
    pub symbol: String,
    /// Mid-price in basis points.
    pub price: u64,
    pub timestamp: DateTime<Utc>,
}

/// Record of a liquidation event (immutable audit trail).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiquidationEvent {
    pub id: Uuid,
    pub position_id: Uuid,
    pub wallet: String,
    pub symbol: String,
    pub side: PositionSide,
    pub size: u64,
    pub entry_price: u64,
    pub mark_price: u64,
    pub margin: u64,
    pub pnl: i64,
    /// Positive = surplus to insurance fund, negative = drawn from fund.
    pub insurance_fund_delta: i64,
    pub liquidated_at: DateTime<Utc>,
}

/// Insurance fund state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsuranceFund {
    pub id: Uuid,
    pub balance: u64,
    pub updated_at: DateTime<Utc>,
}

/// Insurance fund transaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsuranceFundTransaction {
    pub id: Uuid,
    pub amount: i64,
    pub reason: String,
    pub position_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

/// A margin reservation — locks funds atomically before order enters the book.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarginReservation {
    pub id: Uuid,
    pub wallet: String,
    pub symbol: String,
    pub side: PositionSide,
    pub size: u64,
    pub price: u64,
    pub leverage: f64,
    /// Amount of margin locked for this reservation.
    pub reserved_amount: u64,
    pub status: ReservationStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReservationStatus {
    /// Margin is locked, order is in the book.
    Active,
    /// Order filled — reservation converted to position margin.
    Committed,
    /// Order cancelled/expired — margin returned.
    Released,
}

impl ReservationStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Committed => "committed",
            Self::Released => "released",
        }
    }
}

/// Liquidation stage for the waterfall.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LiquidationStage {
    /// Close enough to bring margin back above IM.
    Partial,
    /// Close entire position.
    Full,
    /// Auto-deleverage against most profitable opposing trader.
    Adl,
}

// ── Request / Response DTOs ──

#[derive(Debug, Deserialize)]
pub struct DepositRequest {
    pub wallet: String,
    pub amount: u64,
}

#[derive(Debug, Deserialize)]
pub struct WithdrawRequest {
    pub wallet: String,
    pub amount: u64,
}

#[derive(Debug, Deserialize)]
pub struct ReserveMarginRequest {
    pub wallet: String,
    pub symbol: String,
    pub side: String,
    pub size: u64,
    pub price: u64,
    pub leverage: f64,
}

#[derive(Debug, Serialize)]
pub struct ReserveMarginResponse {
    pub reservation_id: Uuid,
    pub reserved_amount: u64,
    pub max_leverage: f64,
}

#[derive(Debug, Deserialize)]
pub struct OpenPositionRequest {
    pub wallet: String,
    pub symbol: String,
    pub side: String,
    pub size: u64,
    pub price: u64,
    pub leverage: f64,
    /// Reservation ID from the reserve step.
    pub reservation_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct ClosePositionRequest {
    /// Mark price at which position is closed.
    pub mark_price: u64,
}

#[derive(Debug, Deserialize)]
pub struct ValidateTradeRequest {
    pub wallet: String,
    pub symbol: String,
    pub side: String,
    pub size: u64,
    pub price: u64,
    pub leverage: f64,
}

#[derive(Debug, Serialize)]
pub struct ValidateTradeResponse {
    pub valid: bool,
    pub max_leverage: f64,
    pub required_margin: u64,
    pub available_balance: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MarginEstimateRequest {
    pub symbol: String,
    pub side: String,
    pub size: u64,
    pub price: u64,
    pub leverage: f64,
}

#[derive(Debug, Serialize)]
pub struct MarginEstimateResponse {
    pub initial_margin: u64,
    pub maintenance_margin: u64,
    pub liquidation_price: u64,
    pub max_leverage: f64,
}

#[derive(Debug, Serialize)]
pub struct LeverageResponse {
    pub symbol: String,
    pub side: String,
    pub price: u64,
    pub max_leverage: f64,
}
