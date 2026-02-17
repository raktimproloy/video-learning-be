-- Add duration, description, is_preview, notes, assignments to videos table

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='videos' AND column_name='duration_seconds') THEN
        ALTER TABLE videos ADD COLUMN duration_seconds DECIMAL(10, 2) DEFAULT NULL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='videos' AND column_name='description') THEN
        ALTER TABLE videos ADD COLUMN description TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='videos' AND column_name='is_preview') THEN
        ALTER TABLE videos ADD COLUMN is_preview BOOLEAN DEFAULT false;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='videos' AND column_name='notes') THEN
        ALTER TABLE videos ADD COLUMN notes JSONB DEFAULT '[]'::jsonb;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='videos' AND column_name='assignments') THEN
        ALTER TABLE videos ADD COLUMN assignments JSONB DEFAULT '[]'::jsonb;
    END IF;
END
$$;
