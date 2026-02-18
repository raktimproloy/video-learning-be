-- Resume from last position; progress uses max_watched with anti-cheat (total_watch_seconds).
-- last_position_seconds = where the user left off (for resume).
-- max_watched_seconds = furthest point reached (for progress); effective = min(max, total) to prevent seek-cheating.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'video_watch_progress' AND column_name = 'last_position_seconds') THEN
    ALTER TABLE video_watch_progress ADD COLUMN last_position_seconds DECIMAL(12, 2) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Backfill: existing rows use max_watched_seconds as last position so resume behavior is unchanged until next save
UPDATE video_watch_progress
  SET last_position_seconds = max_watched_seconds
  WHERE last_position_seconds = 0 AND max_watched_seconds > 0;

COMMENT ON COLUMN video_watch_progress.last_position_seconds IS 'Position in seconds where user left off; used for resume.';
COMMENT ON COLUMN video_watch_progress.max_watched_seconds IS 'Furthest point reached; course progress uses min(max_watched_seconds, total_watch_seconds) per video.';
