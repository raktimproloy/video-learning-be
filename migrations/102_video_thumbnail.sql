-- 102_video_thumbnail.sql
-- Add thumbnail storage column to videos table

ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS thumbnail_r2_key TEXT;
