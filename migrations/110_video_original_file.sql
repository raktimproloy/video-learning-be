-- 110_video_original_file.sql

-- Add column to track the original (unencrypted) source video
ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS original_r2_key TEXT;
