use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{info, warn};

use crate::config::MONITOR_SWEEP_INTERVAL_MS;
use crate::db::Database;
use crate::liquidation;
use crate::price_feed::MarkPriceMap;
use crate::types::MarkPrice;

/// Start the background risk monitor.
/// Dual-trigger: reactive on price updates + periodic sweep.
pub async fn start_monitor(
    db: Database,
    prices: MarkPriceMap,
    mut price_rx: broadcast::Receiver<MarkPrice>,
) {
    let db = Arc::new(db);
    info!("Risk monitor started (sweep interval: {}ms)", MONITOR_SWEEP_INTERVAL_MS);

    loop {
        tokio::select! {
            // Reactive: process price update immediately
            Ok(mark) = price_rx.recv() => {
                let db = db.clone();
                tokio::spawn(async move {
                    if let Err(e) = check_positions_for_symbol(&db, &mark.symbol, mark.price).await {
                        warn!("Error checking positions for {}: {}", mark.symbol, e);
                    }
                });
            }

            // Periodic sweep: check all open positions
            _ = tokio::time::sleep(tokio::time::Duration::from_millis(MONITOR_SWEEP_INTERVAL_MS)) => {
                let db = db.clone();
                let prices = prices.clone();
                tokio::spawn(async move {
                    if let Err(e) = sweep_all_positions(&db, &prices).await {
                        warn!("Error in periodic sweep: {}", e);
                    }
                });
            }
        }
    }
}

/// Check all open positions for a specific symbol.
async fn check_positions_for_symbol(
    db: &Database,
    symbol: &str,
    mark_price: u64,
) -> Result<(), crate::errors::RiskError> {
    let positions = db.get_open_positions_by_symbol(symbol).await?;

    for pos in &positions {
        match liquidation::check_and_liquidate(db, pos, mark_price).await {
            Ok(Some(result)) => {
                info!(
                    "Liquidation executed: wallet={} symbol={} stage={:?} closed={}",
                    pos.wallet, pos.symbol, result.stage, result.closed_size
                );
            }
            Ok(None) => {}
            Err(e) => {
                warn!(
                    "Liquidation check failed for position {}: {}",
                    pos.id, e
                );
            }
        }
    }

    Ok(())
}

/// Sweep all open positions across all symbols.
async fn sweep_all_positions(
    db: &Database,
    prices: &MarkPriceMap,
) -> Result<(), crate::errors::RiskError> {
    let positions = db.get_all_open_positions().await?;

    for pos in &positions {
        let mark_price = match prices.get(&pos.symbol) {
            Some(mp) => mp.price,
            None => continue, // No price data yet
        };

        match liquidation::check_and_liquidate(db, pos, mark_price).await {
            Ok(Some(result)) => {
                info!(
                    "Sweep liquidation: wallet={} symbol={} stage={:?} closed={}",
                    pos.wallet, pos.symbol, result.stage, result.closed_size
                );
            }
            Ok(None) => {}
            Err(e) => {
                warn!(
                    "Sweep liquidation check failed for position {}: {}",
                    pos.id, e
                );
            }
        }
    }

    Ok(())
}
