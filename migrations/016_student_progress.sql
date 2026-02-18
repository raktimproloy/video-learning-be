-- Student video watch progress and activity (uploaded VOD only, not live stream)
-- One row per user per video: resume position, completion, and aggregate watch time.

CREATE TABLE IF NOT EXISTS video_watch_progress (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    max_watched_seconds DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total_watch_seconds DECIMAL(12, 2) NOT NULL DEFAULT 0,
    completed_at TIMESTAMP NULL,
    last_position_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_video_watch_progress_user_course ON video_watch_progress(user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_video_watch_progress_user_updated ON video_watch_progress(user_id, last_position_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_watch_progress_course ON video_watch_progress(course_id) WHERE course_id IS NOT NULL;

COMMENT ON TABLE video_watch_progress IS 'Tracks how much of each video a student watched; used for resume and completion (95%+ = completed).';
