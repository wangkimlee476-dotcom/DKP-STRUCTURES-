-- DKP STRUCTURES referral tracking (no rewards or commissions).
-- Additive only: existing supporter and contribution rows are preserved.
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(24);
UPDATE users
SET referral_code = 'DKP-' || upper(substr(md5(id::text || random()::text || clock_timestamp()::text), 1, 12))
WHERE referral_code IS NULL OR btrim(referral_code) = '';
ALTER TABLE users ALTER COLUMN referral_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE TABLE IF NOT EXISTS referrals (
  id BIGSERIAL PRIMARY KEY,
  referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  referred_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referrals_no_self_referral CHECK (referrer_user_id <> referred_user_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_created ON referrals(referrer_user_id, created_at DESC);
