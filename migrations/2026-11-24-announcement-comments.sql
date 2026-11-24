-- DKP STRUCTURES community discussion comments.
-- Additive migration: creates the comment store required by the supporter feed.
CREATE TABLE IF NOT EXISTS public.announcement_comments (
  id BIGSERIAL PRIMARY KEY,
  announcement_id INTEGER NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body VARCHAR(2000) NOT NULL,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_announcement_comments_feed
  ON public.announcement_comments(announcement_id, is_hidden, created_at);
