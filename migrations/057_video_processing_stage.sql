-- Add optional processing_stage to video_processing_tasks for frontend status (encrypting / storing).
-- Values: NULL, 'encrypting', 'storing'. Worker updates this so UI can show current step.
ALTER TABLE video_processing_tasks
    ADD COLUMN IF NOT EXISTS processing_stage TEXT NULL
    CHECK (processing_stage IS NULL OR processing_stage IN ('encrypting', 'storing'));
