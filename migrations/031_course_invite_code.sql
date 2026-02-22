-- Add invite_code to courses for shareable invite links
ALTER TABLE courses ADD COLUMN IF NOT EXISTS invite_code VARCHAR(16) UNIQUE;

-- Generate from id hash (deterministic, unique per course)
UPDATE courses
SET invite_code = UPPER(SUBSTRING(MD5(id::text), 1, 8))
WHERE invite_code IS NULL;

-- Default for new courses
ALTER TABLE courses ALTER COLUMN invite_code SET DEFAULT UPPER(
  SUBSTRING(MD5(gen_random_uuid()::text), 1, 8)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_invite_code ON courses(invite_code);
