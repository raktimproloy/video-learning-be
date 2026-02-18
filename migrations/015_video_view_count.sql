-- Add view_count to videos for teacher/analytics
ALTER TABLE videos ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;
