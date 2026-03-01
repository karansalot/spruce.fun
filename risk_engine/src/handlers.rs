use axum::{
    extract::{Path, State},
    Json,
};
use uuid::Uuid;

use crate::db::Database;
use crate::errors::RiskError;
use crate::leverage;
use crate::margin;
use crate::positions;
use crate::price_feed::MarkPriceMap;
use crate::types::*;

/// Shared application state for handlers.
#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub prices: MarkPriceMap,
}

// ── Margin Handlers ──

pub async fn deposit_margin(
    State(state): State<AppState>,
    Json(req): Json<DepositRequest>,
) -> Result<Json<serde_json::Value>, RiskError> {
    state.db.get_or_create_margin_account(&req.wallet).await?;
    let acct = state.db.deposit_margin(&req.wallet, req.amount).await?;
    Ok(Json(serde_json::json!({
        "success": true,
        "account": acct,
    })))
}

pub async fn withdraw_margin(
    State(state): State<AppState>,
    Json(req): Json<WithdrawRequest>,
) -> Result<Json<serde_json::Value>, RiskError> {
    let acct = state.db.withdraw_margin(&req.wallet, req.amount).await?;
    Ok(Json(serde_json::json!({
        "success": true,
        "account": acct,
    })))
}

pub async fn get_margin_account(
    State(state): State<AppState>,
    Path(wallet): Path<String>,
) -> Result<Json<MarginAccount>, RiskError> {
    let acct = state.db.get_margin_account(&wallet).await?;
    Ok(Json(acct))
}

// ── Margin Reservation Handlers (two-phase) ──

pub async fn reserve_margin(
    State(state): State<AppState>,
    Json(req): Json<ReserveMarginRequest>,
) -> Result<Json<serde_json::Value>, RiskError> {
    let side = PositionSide::from_str_loose(&req.side)
        .ok_or_else(|| RiskError::InvalidSide(req.side.clone()))?;

    if !leverage::validate_price(req.price) {
        return Err(RiskError::InvalidPrice(req.price));
    }

    let max_lev = leverage::max_leverage(req.price, side);
    if req.leverage > max_lev || req.leverage < 1.0 {
        return Err(RiskError::LeverageExceeded {
            requested: req.leverage,
            max: max_lev,
        });
    }

    let im = margin::initial_margin(req.size, req.price, req.leverage);

    // Ensure account exists
    state.db.get_or_create_margin_account(&req.wallet).await?;

    let reservation = state
        .db
        .reserve_margin(&req.wallet, &req.symbol, side, req.size, req.price, req.leverage, im)
        .await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "reservation_id": reservation.id,
        "reserved_amount": reservation.reserved_amount,
        "max_leverage": max_lev,
    })))
}

pub async fn release_reservation(
    State(state): State<AppState>,
    Path(reservation_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, RiskError> {
    state.db.release_reservation(reservation_id).await?;
    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Reservation released, margin unlocked",
    })))
}

// ── Position Handlers ──

pub async fn get_positions(
    State(state): State<AppState>,
    Path(wallet): Path<String>,
) -> Result<Json<serde_json::Value>, RiskError> {
    let positions = state.db.get_open_positions_by_wallet(&wallet).await?;
    Ok(Json(serde_json::json!({
        "wallet": wallet,
        "positions": positions,
        "count": positions.len(),
    })))
}

pub async fn get_position(
    State(state): State<AppState>,
    Path((wallet, symbol)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, RiskError> {
    // Try both sides
    let long = state.db.get_open_position(&wallet, &symbol, PositionSide::Long).await?;
    let short = state.db.get_open_position(&wallet, &symbol, PositionSide::Short).await?;

    let mut result = Vec::new();
    if let Some(p) = long {
        result.push(p);
    }
    if let Some(p) = short {
        result.push(p);
    }

    Ok(Json(serde_json::json!({
        "wallet": wallet,
        "symbol": symbol,
        "positions": result,
    })))
}

pub async fn open_position(
    State(state): State<AppState>,
    Json(req): Json<OpenPositionRequest>,
) -> Result<Json<serde_json::Value>, RiskError> {
    let pos = positions::open_position(&state.db, &req).await?;
    Ok(Json(serde_json::json!({
        "success": true,
        "position": pos,
    })))
}

pub async fn close_position_handler(
    State(state): State<AppState>,
    Path((wallet, symbol)): Path<(String, String)>,
    Json(req): Json<ClosePositionRequest>,
) -> Result<Json<serde_json::Value>, RiskError> {
    // Try to figure out side from the path or find the open position
    // Check both sides and close whichever is open
    let long = state.db.get_open_position(&wallet, &symbol, PositionSide::Long).await?;
    let short = state.db.get_open_position(&wallet, &symbol, PositionSide::Short).await?;

    let side = if long.is_some() {
        PositionSide::Long
    } else if short.is_some() {
        PositionSide::Short
    } else {
        return Err(RiskError::PositionNotFound {
            wallet: wallet.clone(),
            symbol: symbol.clone(),
        });
    };

    let (pos, pnl) = positions::close_position(&state.db, &wallet, &symbol, side, req.mark_price).await?;
    Ok(Json(serde_json::json!({
        "success": true,
        "position": pos,
        "realized_pnl": pnl,
    })))
}

// ── Risk Handlers ──

pub async fn get_leverage(
    Path((symbol, side, price)): Path<(String, String, u64)>,
) -> Result<Json<LeverageResponse>, RiskError> {
    let side_enum = PositionSide::from_str_loose(&side)
        .ok_or_else(|| RiskError::InvalidSide(side.clone()))?;

    if !leverage::validate_price(price) {
        return Err(RiskError::InvalidPrice(price));
    }

    let max_lev = leverage::max_leverage(price, side_enum);

    Ok(Json(LeverageResponse {
        symbol,
        side,
        price,
        max_leverage: max_lev,
    }))
}

pub async fn validate_trade(
    State(state): State<AppState>,
    Json(req): Json<ValidateTradeRequest>,
) -> Result<Json<ValidateTradeResponse>, RiskError> {
    let side = PositionSide::from_str_loose(&req.side)
        .ok_or_else(|| RiskError::InvalidSide(req.side.clone()))?;

    if !leverage::validate_price(req.price) {
        return Ok(Json(ValidateTradeResponse {
            valid: false,
            max_leverage: 0.0,
            required_margin: 0,
            available_balance: 0,
            reason: Some(format!("Invalid price: {} bps", req.price)),
        }));
    }

    let max_lev = leverage::max_leverage(req.price, side);
    let im = margin::initial_margin(req.size, req.price, req.leverage);

    let acct = state.db.get_or_create_margin_account(&req.wallet).await?;
    let available = acct.available_balance();

    if req.leverage > max_lev {
        return Ok(Json(ValidateTradeResponse {
            valid: false,
            max_leverage: max_lev,
            required_margin: im,
            available_balance: available,
            reason: Some(format!(
                "Leverage {:.1}x exceeds max {:.1}x for this price/side",
                req.leverage, max_lev
            )),
        }));
    }

    if available < im {
        return Ok(Json(ValidateTradeResponse {
            valid: false,
            max_leverage: max_lev,
            required_margin: im,
            available_balance: available,
            reason: Some(format!(
                "Insufficient margin: need {} bps, have {} bps available",
                im, available
            )),
        }));
    }

    Ok(Json(ValidateTradeResponse {
        valid: true,
        max_leverage: max_lev,
        required_margin: im,
        available_balance: available,
        reason: None,
    }))
}

pub async fn margin_estimate(
    Json(req): Json<MarginEstimateRequest>,
) -> Result<Json<MarginEstimateResponse>, RiskError> {
    let side = PositionSide::from_str_loose(&req.side)
        .ok_or_else(|| RiskError::InvalidSide(req.side.clone()))?;

    if !leverage::validate_price(req.price) {
        return Err(RiskError::InvalidPrice(req.price));
    }

    let max_lev = leverage::max_leverage(req.price, side);
    let effective_leverage = req.leverage.min(max_lev).max(1.0);
    let im = margin::initial_margin(req.size, req.price, effective_leverage);
    let mm = margin::maintenance_margin(im);
    let liq = margin::liquidation_price(side, req.price, im, mm, req.size);

    Ok(Json(MarginEstimateResponse {
        initial_margin: im,
        maintenance_margin: mm,
        liquidation_price: liq,
        max_leverage: max_lev,
    }))
}

// ── Liquidation & Insurance Handlers ──

pub async fn get_liquidation_history(
    State(state): State<AppState>,
    Path(wallet): Path<String>,
) -> Result<Json<serde_json::Value>, RiskError> {
    let events = state.db.get_liquidation_events_by_wallet(&wallet).await?;
    Ok(Json(serde_json::json!({
        "wallet": wallet,
        "liquidations": events,
        "count": events.len(),
    })))
}

pub async fn get_insurance_fund(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, RiskError> {
    let balance = state.db.get_insurance_fund_balance().await?;
    Ok(Json(serde_json::json!({
        "balance": balance,
    })))
}
