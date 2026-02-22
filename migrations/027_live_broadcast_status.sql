-- Add broadcast_status to live_sessions for professional live flow:
-- starting: teacher joined, testing setup, students see "Live Starting Soon"
-- live: students can see video/audio
-- paused: students see "Live is paused"
-- ended: students see "Live has ended"
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS broadcast_status TEXT NOT NULL DEFAULT 'starting'
  CHECK (broadcast_status IN ('starting', 'live', 'paused', 'ended'));
-- Backfill existing active sessions so they show as live
UPDATE live_sessions SET broadcast_status = 'live' WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_live_sessions_broadcast ON live_sessions(broadcast_status) WHERE status = 'active';
