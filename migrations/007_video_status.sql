-- Add status column to videos table
-- Status: 'active', 'inactive', 'processing'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='videos' AND column_name='status') THEN
        ALTER TABLE videos ADD COLUMN status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'processing'));
        -- Set existing videos without processing tasks to 'active'
        UPDATE videos SET status = 'active' WHERE status IS NULL;
        -- Set videos with pending/processing tasks to 'processing'
        UPDATE videos SET status = 'processing' 
        WHERE id IN (
            SELECT DISTINCT video_id 
            FROM video_processing_tasks 
            WHERE status IN ('pending', 'processing')
        );
    END IF;
END
$$;
