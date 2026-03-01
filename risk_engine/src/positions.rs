use chrono::Utc;
use uuid::Uuid;

use crate::db::Database;
use crate::errors::RiskError;
use crate::leverage;
use crate::margin;
use crate::types::*;

/// Open a new position or add to an existing one.
/// If a reservation_id is provided, it is committed (margin already locked).
/// Otherwise, margin is locked directly (legacy path).
pub async fn open_position(
    db: &Database,
    req: &OpenPositionRequest,
) -> Result<Position, RiskError> {
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
    let mm = margin::maintenance_margin(im);
    let liq_price = margin::liquidation_price(side, req.price, im, mm, req.size);

    // Handle reservation commit if provided
    if let Some(reservation_id) = req.reservation_id {
        db.commit_reservation(reservation_id).await?;
    } else {
        // Direct path: lock margin now (no reservation)
        let acct = db.get_or_create_margin_account(&req.wallet).await?;
        if acct.available_balance() < im {
            return Err(RiskError::InsufficientMargin {
                required: im,
                available: acct.available_balance(),
            });
        }
        // Lock it via a reservation that's immediately committed
        let res = db
            .reserve_margin(&req.wallet, &req.symbol, side, req.size, req.price, req.leverage, im)
            .await?;
        db.commit_reservation(res.id).await?;
    }

    // Check if there's an existing open position for this wallet/symbol/side
    if let Some(existing) = db.get_open_position(&req.wallet, &req.symbol, side).await? {
        // Average into existing position
        let new_size = existing.size + req.size;
        let new_entry = ((existing.entry_price as u128 * existing.size as u128
            + req.price as u128 * req.size as u128)
            / new_size as u128) as u64;
        let new_margin = existing.margin + im;
        let new_mm = margin::maintenance_margin(margin::initial_margin(new_size, new_entry, req.leverage));
        let new_liq = margin::liquidation_price(side, new_entry, new_margin, new_mm, new_size);

        let mut updated = existing;
        updated.size = new_size;
        updated.entry_price = new_entry;
        updated.margin = new_margin;
        updated.liquidation_price = new_liq;
        updated.updated_at = Utc::now();

        db.update_position(&updated).await?;
        return Ok(updated);
    }

    // Create new position
    let pos = Position {
        id: Uuid::new_v4(),
        wallet: req.wallet.clone(),
        symbol: req.symbol.clone(),
        side,
        size: req.size,
        entry_price: req.price,
        margin: im,
        leverage: req.leverage,
        liquidation_price: liq_price,
        status: PositionStatus::Open,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    db.insert_position(&pos).await?;
    Ok(pos)
}

/// Close an open position at the given mark price.
/// Realizes PnL and unlocks margin.
pub async fn close_position(
    db: &Database,
    wallet: &str,
    symbol: &str,
    side: PositionSide,
    mark_price: u64,
) -> Result<(Position, i64), RiskError> {
    let pos = db
        .get_open_position(wallet, symbol, side)
        .await?
        .ok_or_else(|| RiskError::PositionNotFound {
            wallet: wallet.to_string(),
            symbol: symbol.to_string(),
        })?;

    if pos.status != PositionStatus::Open {
        return Err(RiskError::PositionAlreadyClosed);
    }

    let pnl = margin::unrealized_pnl(pos.side, pos.size, pos.entry_price, mark_price);

    // Close the position
    db.close_position(pos.id, PositionStatus::Closed).await?;

    // Unlock margin and credit PnL
    db.unlock_margin(&pos.wallet, pos.margin).await?;
    db.credit_pnl(&pos.wallet, pnl).await?;

    let mut closed = pos;
    closed.status = PositionStatus::Closed;
    closed.updated_at = Utc::now();

    Ok((closed, pnl))
}
