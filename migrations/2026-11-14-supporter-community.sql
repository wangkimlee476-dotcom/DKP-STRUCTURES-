-- DKP STRUCTURES community features migration
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_display_name VARCHAR(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_in_ranking BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'Announcement',
  body TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(is_published,is_pinned,published_at DESC);
CREATE TABLE IF NOT EXISTS complaints (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  category VARCHAR(40) NOT NULL CHECK(category IN ('payment','account','contribution_record','staff_conduct','other')),
  subject VARCHAR(120) NOT NULL,
  details VARCHAR(3000) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'received' CHECK(status IN ('received','under_review','resolved')),
  admin_response VARCHAR(3000) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_complaints_user ON complaints(user_id,id DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status,id DESC);
COMMIT;