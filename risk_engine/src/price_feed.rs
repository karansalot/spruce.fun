use dashmap::DashMap;
use futures_util::StreamExt;
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{info, warn};

use crate::config::BACKEND_WS_URL;
use crate::types::MarkPrice;

/// Shared mark-price state: symbol → latest MarkPrice.
pub type MarkPriceMap = Arc<DashMap<String, MarkPrice>>;

/// Start the price-feed WebSocket consumer.
/// Connects to the backend WS, parses orderbook snapshots, computes mid-price,
/// and broadcasts price updates via the channel.
pub async fn start_price_feed(
    prices: MarkPriceMap,
    price_tx: broadcast::Sender<MarkPrice>,
) {
    loop {
        match connect_and_consume(&prices, &price_tx).await {
            Ok(()) => info!("Price feed connection closed, reconnecting..."),
            Err(e) => warn!("Price feed error: {}, reconnecting in 3s...", e),
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
    }
}

async fn connect_and_consume(
    prices: &MarkPriceMap,
    price_tx: &broadcast::Sender<MarkPrice>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let url = format!("{}/ws/prices", BACKEND_WS_URL);
    let (ws_stream, _) = tokio_tungstenite::connect_async(&url).await?;
    info!("Connected to price feed at {}", url);

    let (_write, mut read) = ws_stream.split();

    while let Some(msg) = read.next().await {
        let msg = msg?;
        let text = match msg {
            tokio_tungstenite::tungstenite::Message::Text(t) => t,
            _ => continue,
        };
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&text) {
            process_price_message(&data, prices, price_tx);
        }
    }

    Ok(())
}

fn process_price_message(
    data: &serde_json::Value,
    prices: &MarkPriceMap,
    price_tx: &broadcast::Sender<MarkPrice>,
) {
    let symbol = match data.get("symbol").and_then(|s| s.as_str()) {
        Some(s) => s.to_string(),
        None => return,
    };

    let mid_price_bps = if let (Some(bids), Some(asks)) = (data.get("bids"), data.get("asks")) {
        let best_bid = bids
            .as_array()
            .and_then(|b| b.first())
            .and_then(|level| level.as_array())
            .and_then(|l| l.first())
            .and_then(|p| p.as_f64());
        let best_ask = asks
            .as_array()
            .and_then(|a| a.first())
            .and_then(|level| level.as_array())
            .and_then(|l| l.first())
            .and_then(|p| p.as_f64());

        match (best_bid, best_ask) {
            (Some(bid), Some(ask)) => {
                let mid = (bid + ask) / 2.0;
                if mid < 100.0 {
                    (mid * 10000.0) as u64
                } else {
                    mid as u64
                }
            }
            _ => return,
        }
    } else if let (Some(bid), Some(ask)) = (
        data.get("best_bid").and_then(|b| b.as_f64()),
        data.get("best_ask").and_then(|a| a.as_f64()),
    ) {
        let mid = (bid + ask) / 2.0;
        if mid < 100.0 {
            (mid * 10000.0) as u64
        } else {
            mid as u64
        }
    } else {
        return;
    };

    if mid_price_bps == 0 {
        return;
    }

    let mark = MarkPrice {
        symbol: symbol.clone(),
        price: mid_price_bps,
        timestamp: chrono::Utc::now(),
    };

    prices.insert(symbol, mark.clone());
    let _ = price_tx.send(mark);
}
