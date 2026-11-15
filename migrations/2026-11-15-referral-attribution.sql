-- DKP STRUCTURES referral attribution (no commissions or rewards).
-- Additive schema change: existing supporter and contribution records are preserved.
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(24);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE users
SET referral_code = 'DKP-' || upper(substr(md5(id::text || random()::text || clock_timestamp()::text), 1, 12))
WHERE referral_code IS NULL OR btrim(referral_code) = '';

ALTER TABLE users ALTER COLUMN referral_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_referred_by_user ON users(referred_by_user_id);
