-- Student playback gate: set when enough segments mirrored to R2 (works without Redis).
ALTER TABLE live_sessions
ADD COLUMN IF NOT EXISTS playback_ready_at TIMESTAMPTZ;
