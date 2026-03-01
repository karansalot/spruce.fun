use chrono::Utc;
use tracing::{info, warn};
use uuid::Uuid;

use crate::db::Database;
use crate::errors::RiskError;
use crate::insurance;
use crate::margin;
use crate::types::*;

/// Three-stage liquidation waterfall result.
pub struct LiquidationResult {
    pub stage: LiquidationStage,
    pub closed_size: u64,
    pub pnl: i64,
    pub insurance_delta: i64,
}

/// Check and execute liquidation for a single position at the given mark price.
/// Returns None if no liquidation needed.
///
/// Waterfall:
///   Stage 1 — Partial: close enough contracts to bring margin back above IM
///   Stage 2 — Full: close entire position
///   Stage 3 — ADL: auto-deleverage against profitable opposing traders (future)
pub async fn check_and_liquidate(
    db: &Database,
    pos: &Position,
    mark_price: u64,
) -> Result<Option<LiquidationResult>, RiskError> {
    if pos.status != PositionStatus::Open {
        return Ok(None);
    }

    let pnl = margin::unrealized_pnl(pos.side, pos.size, pos.entry_price, mark_price);
    let balance = margin::margin_balance(pos.margin, pnl);
    let im = margin::initial_margin(pos.size, pos.entry_price, pos.leverage);
    let mm = margin::maintenance_margin(im);

    if !margin::should_liquidate(balance, mm) {
        return Ok(None);
    }

    // Determine how much to close
    let close_size = margin::partial_liquidation_size(
        pos.side,
        pos.size,
        pos.entry_price,
        mark_price,
        pos.margin,
        im,
        mm,
    );

    if close_size == 0 {
        return Ok(None);
    }

    let is_full = close_size >= pos.size;
    let stage = if is_full {
        LiquidationStage::Full
    } else {
        LiquidationStage::Partial
    };

    // Calculate PnL for the portion being closed
    let close_pnl = margin::unrealized_pnl(pos.side, close_size, pos.entry_price, mark_price);
    let close_margin = if is_full {
        pos.margin
    } else {
        (pos.margin as u128 * close_size as u128 / pos.size as u128) as u64
    };

    // Execute the liquidation
    if is_full {
        db.close_position(pos.id, PositionStatus::Liquidated).await?;
        db.unlock_margin(&pos.wallet, pos.margin).await?;
    } else {
        let updated = db.reduce_position_size(pos.id, close_size).await?;
        db.unlock_margin(&pos.wallet, close_margin).await?;

        // Recalculate liquidation price for remaining position
        let remaining_im = margin::initial_margin(updated.size, updated.entry_price, updated.leverage);
        let remaining_mm = margin::maintenance_margin(remaining_im);
        let new_liq = margin::liquidation_price(
            updated.side,
            updated.entry_price,
            updated.margin,
            remaining_mm,
            updated.size,
        );
        let mut recalced = updated;
        recalced.liquidation_price = new_liq;
        db.update_position(&recalced).await?;
    }

    // Handle insurance fund
    let insurance_delta = if close_pnl < 0 {
        let loss = (-close_pnl) as u64;
        if loss <= close_margin {
            // Surplus: margin covers the loss, excess goes to insurance fund
            let surplus = close_margin - loss;
            if surplus > 0 {
                insurance::record_surplus(db, surplus, pos.id).await?;
            }
            // Credit remaining margin minus loss back to user
            db.credit_pnl(&pos.wallet, close_pnl).await?;
            surplus as i64
        } else {
            // Deficit: loss exceeds margin, insurance fund covers the gap
            let deficit = loss - close_margin;
            let drawn = insurance::draw_deficit(db, deficit, pos.id).await?;
            let unrecovered = deficit - drawn;

            if unrecovered > 0 {
                warn!(
                    "Bad debt: {} bps unrecovered for position {} (ADL needed)",
                    unrecovered, pos.id
                );
                // Stage 3 ADL would be triggered here in production
            }

            // User loses all margin (already unlocked above, credited 0)
            -(drawn as i64)
        }
    } else {
        // Position was in profit at liquidation (unusual but possible with fees/slippage)
        db.credit_pnl(&pos.wallet, close_pnl).await?;
        0
    };

    // Record the liquidation event
    let event = LiquidationEvent {
        id: Uuid::new_v4(),
        position_id: pos.id,
        wallet: pos.wallet.clone(),
        symbol: pos.symbol.clone(),
        side: pos.side,
        size: close_size,
        entry_price: pos.entry_price,
        mark_price,
        margin: close_margin,
        pnl: close_pnl,
        insurance_fund_delta: insurance_delta,
        liquidated_at: Utc::now(),
    };

    let stage_str = match stage {
        LiquidationStage::Partial => "partial",
        LiquidationStage::Full => "full",
        LiquidationStage::Adl => "adl",
    };

    db.insert_liquidation_event(&event, stage_str).await?;

    info!(
        "{} liquidation: wallet={} symbol={} side={} closed={}/{} pnl={} ins_delta={}",
        stage_str, pos.wallet, pos.symbol, pos.side, close_size, pos.size, close_pnl, insurance_delta
    );

    Ok(Some(LiquidationResult {
        stage,
        closed_size: close_size,
        pnl: close_pnl,
        insurance_delta,
    }))
}
