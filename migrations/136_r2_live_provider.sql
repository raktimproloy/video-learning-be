-- R2 Live HLS provider: admin toggle, packages, provider checks, session ingest fields.

ALTER TABLE admin_live_settings
ADD COLUMN IF NOT EXISTS r2_live_enabled BOOLEAN NOT NULL DEFAULT false;

UPDATE admin_live_settings SET r2_live_enabled = false WHERE r2_live_enabled IS NULL;

-- live_sessions: ingest stream key + HLS ready timestamp
ALTER TABLE live_sessions
ADD COLUMN IF NOT EXISTS ingest_stream_key TEXT,
ADD COLUMN IF NOT EXISTS hls_ready_at TIMESTAMPTZ;

-- Provider packages
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'live_provider_packages_provider_check'
      AND conrelid = 'live_provider_packages'::regclass
  ) THEN
    ALTER TABLE live_provider_packages DROP CONSTRAINT live_provider_packages_provider_check;
  END IF;
END $$;

ALTER TABLE live_provider_packages
ADD CONSTRAINT live_provider_packages_provider_check
CHECK (provider IN ('agora', 'stream', '100ms', 'youtube', 'aws_ivs', 'r2_live'));

INSERT INTO live_provider_packages (provider, free_minutes_cap, display_order, is_fallback_only)
VALUES ('r2_live', 50000, 5, false)
ON CONFLICT (provider) DO NOTHING;

-- Usage records
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'live_usage_records_provider_check'
      AND conrelid = 'live_usage_records'::regclass
  ) THEN
    ALTER TABLE live_usage_records DROP CONSTRAINT live_usage_records_provider_check;
  END IF;
END $$;

ALTER TABLE live_usage_records
ADD CONSTRAINT live_usage_records_provider_check
CHECK (provider IN ('agora', 'stream', '100ms', 'youtube', 'aws_ivs', 'r2_live'));

-- Live sessions provider
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'live_sessions_provider_check'
      AND conrelid = 'live_sessions'::regclass
  ) THEN
    ALTER TABLE live_sessions DROP CONSTRAINT live_sessions_provider_check;
  END IF;
END $$;

ALTER TABLE live_sessions
ADD CONSTRAINT live_sessions_provider_check
CHECK (provider IN ('agora', 'stream', '100ms', 'aws_ivs', 'youtube', 'r2_live'));

-- Processing tasks: live HLS encrypt from R2 live prefix
ALTER TABLE video_processing_tasks DROP CONSTRAINT IF EXISTS video_processing_tasks_task_type_check;
ALTER TABLE video_processing_tasks
ADD CONSTRAINT video_processing_tasks_task_type_check
CHECK (task_type IN ('initial', 'reencode', 'live_hls_encrypt'));

ALTER TABLE video_processing_tasks
ADD COLUMN IF NOT EXISTS source_r2_prefix TEXT;

CREATE INDEX IF NOT EXISTS idx_live_sessions_ingest_key
ON live_sessions (ingest_stream_key)
WHERE ingest_stream_key IS NOT NULL AND status = 'active';
