/// Risk engine configuration parameters.
/// All prices are in basis points (1 bp = 0.01 cent, so 10000 bp = $1.00).

/// Maximum leverage allowed on the platform.
pub const MAX_LEVERAGE: f64 = 5.0;

/// Minimum leverage (always at least 1x).
pub const MIN_LEVERAGE: f64 = 1.0;

/// Maintenance margin ratio: MM = IM * MAINTENANCE_RATIO.
pub const MAINTENANCE_RATIO: f64 = 0.5;

/// Minimum price in basis points (1 cent).
pub const MIN_PRICE_BPS: u64 = 100;

/// Maximum price in basis points (99 cents).
pub const MAX_PRICE_BPS: u64 = 9900;

/// Full price range in basis points ($1.00).
pub const FULL_RANGE_BPS: u64 = 10000;

/// Risk monitor sweep interval in milliseconds.
pub const MONITOR_SWEEP_INTERVAL_MS: u64 = 500;

/// Risk engine server port.
pub const DEFAULT_PORT: u16 = 3002;

/// Backend WebSocket URL for price feed.
pub const BACKEND_WS_URL: &str = "ws://localhost:8080";
