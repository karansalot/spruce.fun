-- Yellow Network session keys for signature-less transactions
-- Stores session keys when users connect their wallet (DB is source of truth, not localStorage)

CREATE TABLE IF NOT EXISTS yellow_session_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  session_key_address TEXT NOT NULL,
  session_key_private_key TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by wallet
CREATE INDEX IF NOT EXISTS idx_yellow_session_keys_wallet 
  ON yellow_session_keys (wallet_address);

-- Index for finding non-expired sessions
CREATE INDEX IF NOT EXISTS idx_yellow_session_keys_expires 
  ON yellow_session_keys (expires_at);

COMMENT ON TABLE yellow_session_keys IS 'Yellow Network session keys for signature-less transactions. Stored in DB as source of truth.';
