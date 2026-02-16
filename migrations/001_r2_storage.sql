-- R2 storage and lessons VOD support
-- Run after schema.sql (initDb) or on existing DB.

-- Lessons: add columns if missing (for live + recording VOD)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lessons' AND column_name = 'is_live') THEN
    ALTER TABLE lessons ADD COLUMN is_live BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lessons' AND column_name = 'video_url') THEN
    ALTER TABLE lessons ADD COLUMN video_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lessons' AND column_name = 'updated_at') THEN
    ALTER TABLE lessons ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
  END IF;
END
$$;

-- Videos: R2 storage fields
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'videos' AND column_name = 'storage_provider') THEN
    ALTER TABLE videos ADD COLUMN storage_provider TEXT NOT NULL DEFAULT 'local' CHECK (storage_provider IN ('local', 'r2'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'videos' AND column_name = 'r2_key') THEN
    ALTER TABLE videos ADD COLUMN r2_key TEXT;
  END IF;
END
$$;

-- Allow storage_path to be nullable for R2-only videos (we set it to placeholder until processed)
-- Optional: keep NOT NULL and use placeholder
-- COMMENT: storage_path = local path for local; for R2 we store prefix in r2_key and keep storage_path as placeholder or legacy path
