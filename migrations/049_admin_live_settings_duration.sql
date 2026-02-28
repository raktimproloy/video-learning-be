-- Default live class duration in minutes (e.g. 60 = 1 hour). Used by admin to set suggested/max session length.
ALTER TABLE admin_live_settings
ADD COLUMN IF NOT EXISTS live_class_duration_minutes INTEGER DEFAULT 60;

COMMENT ON COLUMN admin_live_settings.live_class_duration_minutes IS 'Default/suggested live class duration in minutes (e.g. 60 for 1 hour).';
