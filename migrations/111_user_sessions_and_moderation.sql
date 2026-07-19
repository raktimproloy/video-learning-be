-- Multi-device login limit, abuse detection, and admin suspension support.

-- One row per issued JWT ("device session").
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    jti UUID NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    device_label TEXT,
    device_type TEXT,
    user_agent TEXT,
    ip_address TEXT,
    status TEXT NOT NULL DEFAULT 'active', -- active | revoked | expired
    revoked_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_status ON user_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_sessions_jti ON user_sessions(jti);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_created ON user_sessions(user_id, created_at);

-- Audit trail: warnings, suspensions, reactivations (system- or admin-issued).
CREATE TABLE IF NOT EXISTS user_moderation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL, -- warning | suspended | reactivated
    reason TEXT NOT NULL,
    actor_type TEXT NOT NULL, -- system | admin
    actor_admin_id UUID REFERENCES users(id),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_moderation_events_user ON user_moderation_events(user_id, created_at);

-- Account-level moderation state.
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'; -- active | suspended
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS warning_issued_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS warning_count INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
