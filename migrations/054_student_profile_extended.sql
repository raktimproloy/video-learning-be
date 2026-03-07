-- Student profile extended: location, phone verification, study section, skills

ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS phone_otp TEXT,
  ADD COLUMN IF NOT EXISTS phone_otp_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS school_name TEXT,
  ADD COLUMN IF NOT EXISTS class TEXT,
  ADD COLUMN IF NOT EXISTS section TEXT,
  ADD COLUMN IF NOT EXISTS skills JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN student_profiles.location IS 'Student location/city';
COMMENT ON COLUMN student_profiles.phone_verified IS 'Whether mobile number is verified via OTP';
COMMENT ON COLUMN student_profiles.school_name IS 'School/institution name';
COMMENT ON COLUMN student_profiles.class IS 'Class or grade';
COMMENT ON COLUMN student_profiles.section IS 'Section';
COMMENT ON COLUMN student_profiles.skills IS 'Array of skill tags';
