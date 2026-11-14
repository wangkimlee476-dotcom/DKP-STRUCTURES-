-- DKP STRUCTURES referral points.
-- Every successful referral registration earns the referrer 20 points.
-- Existing referral rows are backfilled to 20; no users or contribution records are changed.
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS points_awarded INTEGER NOT NULL DEFAULT 20
  CHECK (points_awarded >= 0);
