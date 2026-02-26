-- Live usage tracking and provider packages (free minutes per service).
-- When a new class starts, the system picks a provider that has free minutes; if none, uses AWS IVS.
-- Ongoing classes are never ended when a limit is reached.

-- Provider packages: free minute cap per service (e.g. Agora 10k, 100ms 10k). AWS IVS is fallback when all are exhausted.
CREATE TABLE IF NOT EXISTS live_provider_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL UNIQUE CHECK (provider IN ('agora', '100ms', 'youtube', 'aws_ivs')),
    free_minutes_cap NUMERIC(12,2) NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_fallback_only BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_provider_packages_provider ON live_provider_packages(provider);
CREATE INDEX IF NOT EXISTS idx_live_provider_packages_order ON live_provider_packages(display_order);

INSERT INTO live_provider_packages (provider, free_minutes_cap, display_order, is_fallback_only)
VALUES
    ('agora', 10000, 10, false),
    ('100ms', 10000, 20, false),
    ('youtube', 10000, 30, false),
    ('aws_ivs', 0, 100, true)
ON CONFLICT (provider) DO NOTHING;

-- Per-session, per-participant usage: which service, which teacher/student, how many minutes.
CREATE TABLE IF NOT EXISTS live_usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    live_session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('agora', '100ms', 'youtube', 'aws_ivs')),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
    minutes_used NUMERIC(10,2) NOT NULL,
    session_started_at TIMESTAMPTZ NOT NULL,
    session_ended_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_usage_provider ON live_usage_records(provider);
CREATE INDEX IF NOT EXISTS idx_live_usage_user ON live_usage_records(user_id);
CREATE INDEX IF NOT EXISTS idx_live_usage_session ON live_usage_records(live_session_id);
CREATE INDEX IF NOT EXISTS idx_live_usage_created ON live_usage_records(created_at);

-- Allow provider '100ms' in live_sessions (drop existing provider check, add new)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT conname FROM pg_constraint WHERE conrelid = 'live_sessions'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%provider%')
  LOOP
    EXECUTE 'ALTER TABLE live_sessions DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;
ALTER TABLE live_sessions ADD CONSTRAINT live_sessions_provider_check
    CHECK (provider IN ('agora', '100ms', 'aws_ivs', 'youtube'));

-- Admin: enable/disable 100ms in live settings
ALTER TABLE admin_live_settings ADD COLUMN IF NOT EXISTS hundred_ms_enabled BOOLEAN NOT NULL DEFAULT true;
UPDATE admin_live_settings SET hundred_ms_enabled = true WHERE hundred_ms_enabled IS NULL;
