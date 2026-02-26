-- Admin live settings: master switch + per-provider toggles (agora, aws_ivs, youtube)
-- Single row; when live_class_enabled is false, all live is disabled.

CREATE TABLE IF NOT EXISTS admin_live_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    live_class_enabled BOOLEAN NOT NULL DEFAULT true,
    agora_enabled BOOLEAN NOT NULL DEFAULT true,
    aws_ivs_enabled BOOLEAN NOT NULL DEFAULT false,
    youtube_enabled BOOLEAN NOT NULL DEFAULT true,
    updated_by_admin_id UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO admin_live_settings (id, live_class_enabled, agora_enabled, aws_ivs_enabled, youtube_enabled)
SELECT '00000000-0000-0000-0000-000000000002'::uuid, true, true, false, true
WHERE NOT EXISTS (SELECT 1 FROM admin_live_settings);

-- Provider per live session for usage stats (agora = current implementation)
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'agora'
    CHECK (provider IN ('agora', 'aws_ivs', 'youtube'));
CREATE INDEX IF NOT EXISTS idx_live_sessions_provider ON live_sessions(provider);

DROP TRIGGER IF EXISTS trigger_admin_live_settings_updated_at ON admin_live_settings;
CREATE TRIGGER trigger_admin_live_settings_updated_at
    BEFORE UPDATE ON admin_live_settings
    FOR EACH ROW EXECUTE FUNCTION admin_settings_updated_at();
