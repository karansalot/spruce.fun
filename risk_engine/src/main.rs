mod config;
mod db;
mod errors;
mod handlers;
mod insurance;
mod leverage;
mod liquidation;
mod margin;
mod monitor;
mod positions;
mod price_feed;
mod types;

use axum::{
    routing::{delete, get, post},
    Router,
};
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};
use tracing::info;

use crate::handlers::AppState;
use crate::types::MarkPrice;

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,risk_engine=debug".into()),
        )
        .init();

    // Database
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    info!("Connecting to database...");
    let db = db::Database::new(&database_url)
        .await
        .expect("Failed to connect to database");

    info!("Connected to database");

    if let Err(e) = db.initialize_schema().await {
        tracing::warn!("Schema initialization warning: {}", e);
    } else {
        info!("Database schema initialized");
    }

    // Mark price state
    let prices: price_feed::MarkPriceMap = Arc::new(DashMap::new());
    let (price_tx, price_rx) = broadcast::channel::<MarkPrice>(1000);

    // Start background tasks
    let feed_prices = prices.clone();
    let feed_tx = price_tx.clone();
    tokio::spawn(async move {
        price_feed::start_price_feed(feed_prices, feed_tx).await;
    });

    let monitor_db = db.clone();
    let monitor_prices = prices.clone();
    tokio::spawn(async move {
        monitor::start_monitor(monitor_db, monitor_prices, price_rx).await;
    });

    // App state
    let state = AppState {
        db,
        prices,
    };

    // CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Router
    let app = Router::new()
        // Health
        .route("/health", get(health))
        // Margin
        .route("/margin/deposit", post(handlers::deposit_margin))
        .route("/margin/withdraw", post(handlers::withdraw_margin))
        .route("/margin/:wallet", get(handlers::get_margin_account))
        // Margin Reservations (two-phase)
        .route("/margin/reserve", post(handlers::reserve_margin))
        .route(
            "/margin/reserve/:reservation_id",
            delete(handlers::release_reservation),
        )
        // Positions
        .route("/positions/:wallet", get(handlers::get_positions))
        .route("/positions/:wallet/:symbol", get(handlers::get_position))
        .route("/positions/open", post(handlers::open_position))
        .route(
            "/positions/:wallet/:symbol/close",
            post(handlers::close_position_handler),
        )
        // Risk
        .route(
            "/risk/leverage/:symbol/:side/:price",
            get(handlers::get_leverage),
        )
        .route("/risk/validate", post(handlers::validate_trade))
        .route("/risk/margin-estimate", post(handlers::margin_estimate))
        // Liquidations & Insurance
        .route(
            "/liquidations/:wallet",
            get(handlers::get_liquidation_history),
        )
        .route("/insurance-fund", get(handlers::get_insurance_fund))
        .with_state(state)
        .layer(cors);

    let port = std::env::var("RISK_ENGINE_PORT")
        .unwrap_or_else(|_| config::DEFAULT_PORT.to_string())
        .parse::<u16>()
        .expect("RISK_ENGINE_PORT must be a valid u16");

    let addr = format!("0.0.0.0:{}", port);
    info!("Risk Engine starting on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind");

    axum::serve(listener, app)
        .await
        .expect("Server failed");
}

async fn health() -> &'static str {
    "ok"
}
