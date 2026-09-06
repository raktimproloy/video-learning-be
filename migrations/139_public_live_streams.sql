-- Public live streams: allow sessions to be accessible without enrollment/login
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;

-- Track last heartbeat to fix stuck viewers count
ALTER TABLE live_watch_records ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ DEFAULT NOW();
