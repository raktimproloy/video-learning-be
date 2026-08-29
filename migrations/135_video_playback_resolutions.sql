-- Cached HLS variant labels (360p, 720p, 1080p, legacy, original) for owner UI + re-encode eligibility.
ALTER TABLE videos
    ADD COLUMN IF NOT EXISTS playback_resolutions TEXT[];

CREATE INDEX IF NOT EXISTS idx_videos_playback_resolutions
    ON videos USING GIN (playback_resolutions);
