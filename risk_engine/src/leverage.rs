use crate::config::{FULL_RANGE_BPS, MAX_LEVERAGE, MIN_LEVERAGE, MIN_PRICE_BPS, MAX_PRICE_BPS};
use crate::types::PositionSide;

/// Compute the "risk room" for a given price and side.
/// Risk room = how far the price can move against you before hitting 0 or 100c.
///   LONG  room = price          (price can fall to 0)
///   SHORT room = 10000 - price  (price can rise to 100c)
/// Returns room in basis points.
pub fn risk_room(price_bps: u64, side: PositionSide) -> u64 {
    match side {
        PositionSide::Long => price_bps,
        PositionSide::Short => FULL_RANGE_BPS.saturating_sub(price_bps),
    }
}

/// Discrete leverage bands based on risk room (in cents, 100 bps = 1c).
///
/// | Risk room (cents) | Max leverage |
/// |--------------------|-------------|
/// | 1–20c  (100–2000)  | 1x          |
/// | 21–40c (2100–4000) | 2x          |
/// | 41–60c (4100–6000) | 3x          |
/// | 61–80c (6100–8000) | 4x          |
/// | 81–99c (8100–9900) | 5x          |
pub fn max_leverage(price_bps: u64, side: PositionSide) -> f64 {
    let room = risk_room(price_bps, side);
    // Convert bps to cents: 100 bps = 1 cent
    let room_cents = room / 100;

    let lev: f64 = match room_cents {
        0..=20 => 1.0,
        21..=40 => 2.0,
        41..=60 => 3.0,
        61..=80 => 4.0,
        _ => 5.0,
    };

    lev.clamp(MIN_LEVERAGE, MAX_LEVERAGE)
}

/// Validate that a requested leverage is within bounds for the given price/side.
pub fn validate_leverage(price_bps: u64, side: PositionSide, requested: f64) -> Result<f64, f64> {
    let max = max_leverage(price_bps, side);
    if requested > max {
        Err(max)
    } else if requested < MIN_LEVERAGE {
        Err(max)
    } else {
        Ok(requested)
    }
}

/// Validate that a price is within the valid range for binary markets.
pub fn validate_price(price_bps: u64) -> bool {
    price_bps >= MIN_PRICE_BPS && price_bps <= MAX_PRICE_BPS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_risk_room() {
        // LONG at 50c (5000 bps) → room = 5000
        assert_eq!(risk_room(5000, PositionSide::Long), 5000);
        // SHORT at 50c → room = 5000
        assert_eq!(risk_room(5000, PositionSide::Short), 5000);
        // LONG at 10c (1000 bps) → room = 1000
        assert_eq!(risk_room(1000, PositionSide::Long), 1000);
        // SHORT at 10c → room = 9000
        assert_eq!(risk_room(1000, PositionSide::Short), 9000);
    }

    #[test]
    fn test_leverage_bands_long() {
        // 1c (100 bps) LONG → room=100 → 1 cent → 1x
        assert_eq!(max_leverage(100, PositionSide::Long), 1.0);
        // 10c (1000 bps) LONG → room=1000 → 10 cents → 1x
        assert_eq!(max_leverage(1000, PositionSide::Long), 1.0);
        // 20c (2000 bps) LONG → room=2000 → 20 cents → 1x
        assert_eq!(max_leverage(2000, PositionSide::Long), 1.0);
        // 25c (2500 bps) LONG → room=2500 → 25 cents → 2x
        assert_eq!(max_leverage(2500, PositionSide::Long), 2.0);
        // 40c (4000 bps) LONG → room=4000 → 40 cents → 2x
        assert_eq!(max_leverage(4000, PositionSide::Long), 2.0);
        // 50c (5000 bps) LONG → room=5000 → 50 cents → 3x
        assert_eq!(max_leverage(5000, PositionSide::Long), 3.0);
        // 70c (7000 bps) LONG → room=7000 → 70 cents → 4x
        assert_eq!(max_leverage(7000, PositionSide::Long), 4.0);
        // 90c (9000 bps) LONG → room=9000 → 90 cents → 5x
        assert_eq!(max_leverage(9000, PositionSide::Long), 5.0);
        // 99c (9900 bps) LONG → room=9900 → 99 cents → 5x
        assert_eq!(max_leverage(9900, PositionSide::Long), 5.0);
    }

    #[test]
    fn test_leverage_bands_short_symmetric() {
        // SHORT at 90c → room = 1000 → 10 cents → 1x
        assert_eq!(max_leverage(9000, PositionSide::Short), 1.0);
        // SHORT at 50c → room = 5000 → 50 cents → 3x
        assert_eq!(max_leverage(5000, PositionSide::Short), 3.0);
        // SHORT at 10c → room = 9000 → 90 cents → 5x
        assert_eq!(max_leverage(1000, PositionSide::Short), 5.0);
    }

    #[test]
    fn test_validate_leverage() {
        // 50c LONG max=3x, requesting 2x → ok
        assert_eq!(validate_leverage(5000, PositionSide::Long, 2.0), Ok(2.0));
        // 50c LONG max=3x, requesting 4x → err(3.0)
        assert_eq!(validate_leverage(5000, PositionSide::Long, 4.0), Err(3.0));
    }

    #[test]
    fn test_validate_price() {
        assert!(validate_price(100));
        assert!(validate_price(5000));
        assert!(validate_price(9900));
        assert!(!validate_price(0));
        assert!(!validate_price(99));
        assert!(!validate_price(10000));
        assert!(!validate_price(10001));
    }
}
