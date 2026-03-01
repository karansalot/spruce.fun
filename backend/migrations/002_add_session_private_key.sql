-- Run this if you already created the table with the old schema (without session_key_private_key)
ALTER TABLE yellow_session_keys ADD COLUMN IF NOT EXISTS session_key_private_key TEXT;
