-- Optional display name when an external listing has no teacher account (or in addition to teacher on cards).
ALTER TABLE courses ADD COLUMN IF NOT EXISTS institution_name TEXT;

COMMENT ON COLUMN courses.institution_name IS 'Institution or organization name for external URL courses (e.g. when no teacher is linked).';
