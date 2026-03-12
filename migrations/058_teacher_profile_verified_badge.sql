-- Teacher verified badge based on profile completion.
-- is_verified is the ONLY badge-like flag for teachers.
ALTER TABLE teacher_profiles
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_teacher_profiles_is_verified ON teacher_profiles(is_verified);

COMMENT ON COLUMN teacher_profiles.is_verified IS 'True when teacher profile completion >= 60%. Managed by backend on create/update.';

