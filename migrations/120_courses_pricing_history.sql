ALTER TABLE courses ADD COLUMN IF NOT EXISTS pricing_history JSONB DEFAULT '[]'::jsonb;
