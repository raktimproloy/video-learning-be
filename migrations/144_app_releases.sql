-- APK release history for the mobile app's public download page.
-- Admin uploads a signed release APK here; the "current" one is what
-- /v1/app/download serves and what the public /v1/settings payload
-- advertises (version, size, changelog) for the download page + force-
-- update gate to reference. Checksum/size are computed server-side on
-- upload, never trusted from admin input.

CREATE TABLE IF NOT EXISTS app_releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_name TEXT NOT NULL,
    version_code INTEGER NOT NULL,
    file_key TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    sha256_checksum TEXT NOT NULL,
    changelog TEXT NOT NULL DEFAULT '',
    is_current BOOLEAN NOT NULL DEFAULT false,
    created_by_admin_id UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Only one release can be "current" (live on the download page) at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_releases_one_current
    ON app_releases (is_current)
    WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_app_releases_version_code
    ON app_releases (version_code DESC);

DROP TRIGGER IF EXISTS trigger_app_releases_updated_at ON app_releases;
CREATE TRIGGER trigger_app_releases_updated_at
    BEFORE UPDATE ON app_releases
    FOR EACH ROW EXECUTE FUNCTION admin_settings_updated_at();
