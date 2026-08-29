-- Video playback optimization: processing task status, version original key, task type

-- Allow cancelled status (used by retry/re-encode flows)
ALTER TABLE video_processing_tasks DROP CONSTRAINT IF EXISTS video_processing_tasks_status_check;
ALTER TABLE video_processing_tasks ADD CONSTRAINT video_processing_tasks_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'));

-- Match videoService.saveVideoVersion expectations
ALTER TABLE video_versions
    ADD COLUMN IF NOT EXISTS original_r2_key TEXT;

-- Distinguish initial upload encode vs re-encode of active videos
ALTER TABLE video_processing_tasks
    ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'initial'
    CHECK (task_type IN ('initial', 'reencode'));

CREATE INDEX IF NOT EXISTS idx_video_processing_tasks_task_type
    ON video_processing_tasks(task_type);
