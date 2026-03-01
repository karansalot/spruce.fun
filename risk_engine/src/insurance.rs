use crate::db::Database;
use crate::errors::RiskError;
use uuid::Uuid;

/// Get the current insurance fund balance.
pub async fn get_balance(db: &Database) -> Result<u64, RiskError> {
    db.get_insurance_fund_balance().await
}

/// Record a surplus from a liquidation (loss < margin deposited).
pub async fn record_surplus(
    db: &Database,
    amount: u64,
    position_id: Uuid,
) -> Result<u64, RiskError> {
    db.update_insurance_fund(
        amount as i64,
        "liquidation_surplus",
        Some(position_id),
    )
    .await
}

/// Draw from the insurance fund to cover a deficit (loss > margin deposited).
/// Returns how much was actually drawn (capped at fund balance).
pub async fn draw_deficit(
    db: &Database,
    amount: u64,
    position_id: Uuid,
) -> Result<u64, RiskError> {
    let current = db.get_insurance_fund_balance().await?;
    let draw = amount.min(current);

    if draw > 0 {
        db.update_insurance_fund(
            -(draw as i64),
            "liquidation_deficit",
            Some(position_id),
        )
        .await?;
    }

    Ok(draw)
}
