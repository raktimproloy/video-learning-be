-- When teacher hits time limit, frontend reports limit-reached; backend force-ends after grace period.
-- Ensures usage (Agora/100ms minutes) is always recorded via endDiscarded -> recordUsageForSession.
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS limit_reached_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS idx_live_sessions_limit_reached
  ON live_sessions(limit_reached_at) WHERE status = 'active' AND limit_reached_at IS NOT NULL;
