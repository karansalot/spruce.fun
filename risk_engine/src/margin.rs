use crate::config::MAINTENANCE_RATIO;
use crate::types::PositionSide;

/// Compute initial margin required for a position.
/// IM = (size * price) / leverage   (all in basis points)
pub fn initial_margin(size: u64, price: u64, leverage: f64) -> u64 {
    if leverage <= 0.0 {
        return u64::MAX;
    }
    ((size as f64 * price as f64) / leverage).ceil() as u64
}

/// Compute maintenance margin (50% of IM by default).
/// MM = IM * MAINTENANCE_RATIO
pub fn maintenance_margin(im: u64) -> u64 {
    (im as f64 * MAINTENANCE_RATIO).ceil() as u64
}

/// Compute unrealized PnL for a position.
/// Returns signed value (positive = profit, negative = loss).
///   LONG:  pnl = size * (mark - entry)
///   SHORT: pnl = size * (entry - mark)
pub fn unrealized_pnl(side: PositionSide, size: u64, entry_price: u64, mark_price: u64) -> i64 {
    match side {
        PositionSide::Long => {
            size as i64 * (mark_price as i64 - entry_price as i64)
        }
        PositionSide::Short => {
            size as i64 * (entry_price as i64 - mark_price as i64)
        }
    }
}

/// Compute margin balance = deposited_margin + unrealized_pnl.
/// Clamped to 0 (can't go negative — that's bad debt).
pub fn margin_balance(deposited_margin: u64, pnl: i64) -> u64 {
    let balance = deposited_margin as i64 + pnl;
    if balance < 0 { 0 } else { balance as u64 }
}

/// Compute the liquidation price for a position.
///   LONG:  liq_price = entry - (margin - MM) / size
///   SHORT: liq_price = entry + (margin - MM) / size
/// Returns 0 if the computation underflows (position can't be liquidated before price hits 0).
pub fn liquidation_price(
    side: PositionSide,
    entry_price: u64,
    margin: u64,
    maintenance: u64,
    size: u64,
) -> u64 {
    if size == 0 {
        return 0;
    }
    let cushion = margin.saturating_sub(maintenance);
    let per_unit = cushion / size;

    match side {
        PositionSide::Long => entry_price.saturating_sub(per_unit),
        PositionSide::Short => entry_price.saturating_add(per_unit),
    }
}

/// Check if a position should be liquidated.
/// Returns true if margin_balance < maintenance_margin.
pub fn should_liquidate(margin_bal: u64, maintenance: u64) -> bool {
    margin_bal < maintenance
}

/// Determine how many contracts to close for a partial liquidation.
/// Goal: bring margin balance back up to initial margin level.
/// Returns the number of contracts to close (capped at full size).
pub fn partial_liquidation_size(
    side: PositionSide,
    size: u64,
    entry_price: u64,
    mark_price: u64,
    margin: u64,
    im: u64,
    mm: u64,
) -> u64 {
    let pnl = unrealized_pnl(side, size, entry_price, mark_price);
    let current_balance = margin_balance(margin, pnl);

    // If margin balance is critically low (< 50% of MM), skip partial → go full
    if current_balance < mm / 2 {
        return size;
    }

    // We need to close enough to bring balance back above IM.
    // Each contract closed realizes its PnL and frees margin proportionally.
    // Approximate: close_size = size * (1 - current_balance / im)
    if current_balance >= im {
        return 0; // No liquidation needed
    }

    let deficit = im.saturating_sub(current_balance);
    // Each contract closed frees roughly (margin/size) of margin
    let margin_per_contract = if size > 0 { margin / size } else { 1 };
    let loss_per_contract = match side {
        PositionSide::Long => entry_price.saturating_sub(mark_price),
        PositionSide::Short => mark_price.saturating_sub(entry_price),
    };
    let freed_per_contract = margin_per_contract.saturating_sub(loss_per_contract);

    if freed_per_contract == 0 {
        return size; // Can't partial — each contract frees nothing
    }

    let needed = (deficit + freed_per_contract - 1) / freed_per_contract; // ceil division
    needed.min(size)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_margin() {
        // 100 contracts at 5000 bps, 5x leverage → 100*5000/5 = 100000
        assert_eq!(initial_margin(100, 5000, 5.0), 100000);
        // 10 contracts at 2000 bps, 2x → 10*2000/2 = 10000
        assert_eq!(initial_margin(10, 2000, 2.0), 10000);
        // 1x leverage → notional
        assert_eq!(initial_margin(1, 5000, 1.0), 5000);
    }

    #[test]
    fn test_maintenance_margin() {
        // MM = IM * 0.5
        assert_eq!(maintenance_margin(100000), 50000);
        assert_eq!(maintenance_margin(10000), 5000);
        assert_eq!(maintenance_margin(1), 1); // ceil(0.5) = 1
    }

    #[test]
    fn test_unrealized_pnl() {
        // LONG: bought at 5000, now at 5500, 10 contracts → 10*(5500-5000) = 5000
        assert_eq!(unrealized_pnl(PositionSide::Long, 10, 5000, 5500), 5000);
        // LONG: bought at 5000, now at 4500 → 10*(4500-5000) = -5000
        assert_eq!(unrealized_pnl(PositionSide::Long, 10, 5000, 4500), -5000);
        // SHORT: sold at 5000, now at 4500 → 10*(5000-4500) = 5000
        assert_eq!(unrealized_pnl(PositionSide::Short, 10, 5000, 4500), 5000);
        // SHORT: sold at 5000, now at 5500 → 10*(5000-5500) = -5000
        assert_eq!(unrealized_pnl(PositionSide::Short, 10, 5000, 5500), -5000);
    }

    #[test]
    fn test_margin_balance() {
        assert_eq!(margin_balance(10000, 5000), 15000);
        assert_eq!(margin_balance(10000, -5000), 5000);
        assert_eq!(margin_balance(10000, -15000), 0); // clamped
    }

    #[test]
    fn test_liquidation_price() {
        // LONG: entry=5000, margin=10000, MM=5000, size=10
        // cushion = 10000-5000 = 5000, per_unit = 500
        // liq = 5000 - 500 = 4500
        assert_eq!(liquidation_price(PositionSide::Long, 5000, 10000, 5000, 10), 4500);

        // SHORT: entry=5000, margin=10000, MM=5000, size=10
        // liq = 5000 + 500 = 5500
        assert_eq!(liquidation_price(PositionSide::Short, 5000, 10000, 5000, 10), 5500);
    }

    #[test]
    fn test_should_liquidate() {
        assert!(should_liquidate(4999, 5000));
        assert!(!should_liquidate(5000, 5000));
        assert!(!should_liquidate(5001, 5000));
    }

    #[test]
    fn test_partial_liquidation_size() {
        // Position: 100 contracts LONG at 5000, margin=100000, IM=100000, MM=50000
        // Mark dropped to 4800 → pnl = 100*(4800-5000) = -20000
        // Balance = 100000 - 20000 = 80000, which is < IM (100000)
        // deficit = 100000 - 80000 = 20000
        // margin_per_contract = 100000/100 = 1000
        // loss_per_contract = 5000 - 4800 = 200
        // freed_per_contract = 1000 - 200 = 800
        // needed = ceil(20000/800) = 25
        assert_eq!(
            partial_liquidation_size(PositionSide::Long, 100, 5000, 4800, 100000, 100000, 50000),
            25
        );

        // Critically low balance (< 50% of MM) → full liquidation
        // Mark crashed to 4000 → pnl = 100*(4000-5000) = -100000
        // Balance = 100000 - 100000 = 0, which is < MM/2 (25000)
        assert_eq!(
            partial_liquidation_size(PositionSide::Long, 100, 5000, 4000, 100000, 100000, 50000),
            100 // full liquidation
        );

        // No liquidation needed — balance above IM
        assert_eq!(
            partial_liquidation_size(PositionSide::Long, 100, 5000, 5200, 100000, 100000, 50000),
            0
        );
    }
}
