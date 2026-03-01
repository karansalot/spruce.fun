-- Migration 003: Beta access codes table
-- Creates a table for invite-only beta access codes (single-use)

CREATE TABLE IF NOT EXISTS beta_access_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT UNIQUE NOT NULL,
  used       BOOLEAN DEFAULT false,
  used_at    TIMESTAMPTZ,
  used_by    TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Generate 100 unique 8-character uppercase alphanumeric codes
INSERT INTO beta_access_codes (code)
SELECT upper(substr(md5(random()::text || clock_timestamp()::text || s::text), 1, 8))
FROM generate_series(1, 100) AS s
ON CONFLICT (code) DO NOTHING;
