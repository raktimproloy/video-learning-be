-- Add materials and exams JSONB columns to live_sessions
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS materials JSONB DEFAULT '[]'::jsonb;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS exams JSONB DEFAULT '[]'::jsonb;
