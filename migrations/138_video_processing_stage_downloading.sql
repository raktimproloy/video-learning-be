-- Live save (live_hls_encrypt): worker uses 'downloading' while fetching segments from R2.
ALTER TABLE video_processing_tasks DROP CONSTRAINT IF EXISTS video_processing_tasks_processing_stage_check;

ALTER TABLE video_processing_tasks
ADD CONSTRAINT video_processing_tasks_processing_stage_check
CHECK (processing_stage IS NULL OR processing_stage IN ('downloading', 'encrypting', 'storing'));
