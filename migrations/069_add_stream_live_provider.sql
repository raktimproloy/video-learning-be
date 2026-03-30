-- Add GetStream as a separate live provider without changing existing providers.

-- 1) Admin live settings toggle for Stream
ALTER TABLE admin_live_settings
ADD COLUMN IF NOT EXISTS stream_enabled BOOLEAN NOT NULL DEFAULT false;

UPDATE admin_live_settings
SET stream_enabled = false
WHERE stream_enabled IS NULL;

-- 2) Provider packages support Stream
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'live_provider_packages_provider_check'
      AND conrelid = 'live_provider_packages'::regclass
  ) THEN
    ALTER TABLE live_provider_packages DROP CONSTRAINT live_provider_packages_provider_check;
  END IF;
END $$;

ALTER TABLE live_provider_packages
ADD CONSTRAINT live_provider_packages_provider_check
CHECK (provider IN ('agora', 'stream', '100ms', 'youtube', 'aws_ivs'));

INSERT INTO live_provider_packages (provider, free_minutes_cap, display_order, is_fallback_only)
VALUES ('stream', 10000, 15, false)
ON CONFLICT (provider) DO NOTHING;

-- 3) Usage table support Stream
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'live_usage_records_provider_check'
      AND conrelid = 'live_usage_records'::regclass
  ) THEN
    ALTER TABLE live_usage_records DROP CONSTRAINT live_usage_records_provider_check;
  END IF;
END $$;

ALTER TABLE live_usage_records
ADD CONSTRAINT live_usage_records_provider_check
CHECK (provider IN ('agora', 'stream', '100ms', 'youtube', 'aws_ivs'));

-- 4) Live sessions provider check support Stream
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'live_sessions_provider_check'
      AND conrelid = 'live_sessions'::regclass
  ) THEN
    ALTER TABLE live_sessions DROP CONSTRAINT live_sessions_provider_check;
  END IF;
END $$;

ALTER TABLE live_sessions
ADD CONSTRAINT live_sessions_provider_check
CHECK (provider IN ('agora', 'stream', '100ms', 'aws_ivs', 'youtube'));

