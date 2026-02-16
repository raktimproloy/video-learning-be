-- Add is_preview, notes, and assignments to lessons table

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lessons' AND column_name='is_preview') THEN
        ALTER TABLE lessons ADD COLUMN is_preview BOOLEAN DEFAULT false;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lessons' AND column_name='notes') THEN
        ALTER TABLE lessons ADD COLUMN notes JSONB DEFAULT '[]'::jsonb;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lessons' AND column_name='assignments') THEN
        ALTER TABLE lessons ADD COLUMN assignments JSONB DEFAULT '[]'::jsonb;
    END IF;
END
$$;
