use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};

#[derive(Debug, thiserror::Error)]
pub enum RiskError {
    #[error("insufficient margin: required {required} bps, available {available} bps")]
    InsufficientMargin { required: u64, available: u64 },

    #[error("leverage {requested:.2}x exceeds maximum {max:.2}x for this price/side")]
    LeverageExceeded { requested: f64, max: f64 },

    #[error("position not found for wallet {wallet} symbol {symbol}")]
    PositionNotFound { wallet: String, symbol: String },

    #[error("margin account not found for wallet {wallet}")]
    MarginAccountNotFound { wallet: String },

    #[error("insufficient balance: tried to withdraw {requested} bps, available {available} bps")]
    InsufficientBalance { requested: u64, available: u64 },

    #[error("invalid price: {0} bps (must be 100-9900)")]
    InvalidPrice(u64),

    #[error("invalid side: {0}")]
    InvalidSide(String),

    #[error("position already closed")]
    PositionAlreadyClosed,

    #[error("database error: {0}")]
    Database(String),

    #[error("internal error: {0}")]
    Internal(String),
}

impl IntoResponse for RiskError {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            RiskError::InsufficientMargin { .. } => StatusCode::BAD_REQUEST,
            RiskError::LeverageExceeded { .. } => StatusCode::BAD_REQUEST,
            RiskError::PositionNotFound { .. } => StatusCode::NOT_FOUND,
            RiskError::MarginAccountNotFound { .. } => StatusCode::NOT_FOUND,
            RiskError::InsufficientBalance { .. } => StatusCode::BAD_REQUEST,
            RiskError::InvalidPrice(_) => StatusCode::BAD_REQUEST,
            RiskError::InvalidSide(_) => StatusCode::BAD_REQUEST,
            RiskError::PositionAlreadyClosed => StatusCode::CONFLICT,
            RiskError::Database(_) => StatusCode::INTERNAL_SERVER_ERROR,
            RiskError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let body = serde_json::json!({
            "success": false,
            "error": self.to_string(),
        });

        (status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for RiskError {
    fn from(e: sqlx::Error) -> Self {
        RiskError::Database(e.to_string())
    }
}
