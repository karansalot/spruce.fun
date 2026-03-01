-- Risk Engine Database Schema
-- Runs against the same Supabase PostgreSQL as the orderbook.

-- ── Margin Accounts ──
CREATE TABLE IF NOT EXISTS margin_accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet      TEXT NOT NULL UNIQUE,
    balance     BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
    locked_margin BIGINT NOT NULL DEFAULT 0 CHECK (locked_margin >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_margin_accounts_wallet ON margin_accounts(wallet);

-- ── Margin Reservations (two-phase commit) ──
CREATE TABLE IF NOT EXISTS margin_reservations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet          TEXT NOT NULL REFERENCES margin_accounts(wallet),
    symbol          TEXT NOT NULL,
    side            TEXT NOT NULL CHECK (side IN ('long', 'short')),
    size            BIGINT NOT NULL CHECK (size > 0),
    price           BIGINT NOT NULL CHECK (price > 0),
    leverage        DOUBLE PRECISION NOT NULL CHECK (leverage >= 1.0),
    reserved_amount BIGINT NOT NULL CHECK (reserved_amount > 0),
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'committed', 'released')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_margin_reservations_wallet ON margin_reservations(wallet);
CREATE INDEX IF NOT EXISTS idx_margin_reservations_status ON margin_reservations(status) WHERE status = 'active';

-- ── Positions ──
CREATE TABLE IF NOT EXISTS positions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet          TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    side            TEXT NOT NULL CHECK (side IN ('long', 'short')),
    size            BIGINT NOT NULL CHECK (size > 0),
    entry_price     BIGINT NOT NULL CHECK (entry_price > 0),
    margin          BIGINT NOT NULL CHECK (margin >= 0),
    leverage        DOUBLE PRECISION NOT NULL CHECK (leverage >= 1.0),
    liquidation_price BIGINT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'liquidated')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_positions_wallet ON positions(wallet);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);
CREATE INDEX IF NOT EXISTS idx_positions_open ON positions(status) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_wallet_symbol_open
    ON positions(wallet, symbol, side) WHERE status = 'open';

-- ── Liquidation Events (immutable audit trail) ──
CREATE TABLE IF NOT EXISTS liquidation_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id     UUID NOT NULL REFERENCES positions(id),
    wallet          TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    side            TEXT NOT NULL,
    stage           TEXT NOT NULL CHECK (stage IN ('partial', 'full', 'adl')),
    size            BIGINT NOT NULL,
    entry_price     BIGINT NOT NULL,
    mark_price      BIGINT NOT NULL,
    margin          BIGINT NOT NULL,
    pnl             BIGINT NOT NULL,
    insurance_fund_delta BIGINT NOT NULL DEFAULT 0,
    liquidated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_liquidation_events_wallet ON liquidation_events(wallet);
CREATE INDEX IF NOT EXISTS idx_liquidation_events_position ON liquidation_events(position_id);

-- ── Insurance Fund ──
CREATE TABLE IF NOT EXISTS insurance_fund (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    balance     BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with a single row if empty
INSERT INTO insurance_fund (balance)
SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM insurance_fund);

-- ── Insurance Fund Transactions ──
CREATE TABLE IF NOT EXISTS insurance_fund_transactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amount      BIGINT NOT NULL,
    reason      TEXT NOT NULL,
    position_id UUID REFERENCES positions(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
