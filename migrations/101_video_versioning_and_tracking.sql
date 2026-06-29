-- 101_video_versioning_and_tracking.sql

-- Add tracking and version columns to the videos table
ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS last_updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS last_updated_by_role TEXT,
ADD COLUMN IF NOT EXISTS version_number INTEGER DEFAULT 1;

-- Table to store historical video files
CREATE TABLE IF NOT EXISTS video_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    signing_secret TEXT NOT NULL,
    r2_key TEXT,
    duration_seconds DECIMAL(10, 2),
    size_bytes BIGINT DEFAULT 0,
    version_number INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_role TEXT
);

-- Index for faster history lookups
CREATE INDEX IF NOT EXISTS idx_video_versions_video_id ON video_versions(video_id);
