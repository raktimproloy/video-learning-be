-- Add is_invited to course_enrollments for tracking invited purchases
ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS is_invited BOOLEAN NOT NULL DEFAULT false;
