-- Backfill default profile images for existing student and teacher profiles.
-- Uses environment-configurable paths but falls back to /images defaults.

-- Teacher profiles without a profile image get the default teacher avatar.
UPDATE teacher_profiles
SET profile_image_path = COALESCE(NULLIF(current_setting('app.default_teacher_avatar_path', true), ''), '/images/default-teacher.png')
WHERE (profile_image_path IS NULL OR TRIM(profile_image_path) = '');

-- Student profiles without a profile image get the default student avatar.
UPDATE student_profiles
SET profile_image_path = COALESCE(NULLIF(current_setting('app.default_student_avatar_path', true), ''), '/images/default-student.png')
WHERE (profile_image_path IS NULL OR TRIM(profile_image_path) = '');

