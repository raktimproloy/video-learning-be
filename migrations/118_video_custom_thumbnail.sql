-- 118_video_custom_thumbnail.sql
-- Teacher-uploaded cover image, stored separately from the auto first-frame JPEG
-- so video reprocessing cannot overwrite it.

ALTER TABLE videos
ADD COLUMN IF NOT EXISTS custom_thumbnail_r2_key TEXT;
