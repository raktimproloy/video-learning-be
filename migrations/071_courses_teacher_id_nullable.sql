-- Allow courses without a teacher (e.g. admin-created external URL courses; assign teacher later).
ALTER TABLE courses ALTER COLUMN teacher_id DROP NOT NULL;
