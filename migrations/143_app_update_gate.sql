-- Force-update gate: admin toggles a blocking modal shown app-wide on the
-- mobile app (title + description + a link, e.g. to the APK download page)
-- until the admin turns it back off. Single row, same pattern as
-- admin_live_settings.

CREATE TABLE IF NOT EXISTS app_update_gate_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enabled BOOLEAN NOT NULL DEFAULT false,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    updated_by_admin_id UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO app_update_gate_settings (id, enabled, title, description, link)
SELECT '00000000-0000-0000-0000-000000000003'::uuid, false, '', '', ''
WHERE NOT EXISTS (SELECT 1 FROM app_update_gate_settings);

DROP TRIGGER IF EXISTS trigger_app_update_gate_settings_updated_at ON app_update_gate_settings;
CREATE TRIGGER trigger_app_update_gate_settings_updated_at
    BEFORE UPDATE ON app_update_gate_settings
    FOR EACH ROW EXECUTE FUNCTION admin_settings_updated_at();
