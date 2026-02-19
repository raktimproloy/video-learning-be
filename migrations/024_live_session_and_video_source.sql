-- Live session metadata when teacher starts live
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS live_session_name TEXT;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS live_session_order INTEGER DEFAULT 0;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS live_session_description TEXT;

-- Video source: 'upload' (default) or 'live' for saved live recordings
ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'upload' CHECK (source_type IN ('upload', 'live'));
