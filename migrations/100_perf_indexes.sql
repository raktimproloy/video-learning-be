-- Performance indexes for high-frequency write paths (heartbeats, progress)
CREATE INDEX IF NOT EXISTS idx_page_views_id_updated ON page_views (id) WHERE id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_video_watch_progress_user_video ON video_watch_progress (user_id, video_id);
CREATE INDEX IF NOT EXISTS idx_live_watch_records_active ON live_watch_records (lesson_id, student_id) WHERE left_at IS NULL;
