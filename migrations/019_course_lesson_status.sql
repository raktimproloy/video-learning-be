-- Add status column to courses: active, inactive, draft, archived
ALTER TABLE courses ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_status_check;
ALTER TABLE courses ADD CONSTRAINT courses_status_check 
    CHECK (status IN ('active', 'inactive', 'draft', 'archived'));
UPDATE courses SET status = 'active' WHERE status IS NULL;
ALTER TABLE courses ALTER COLUMN status SET DEFAULT 'active';

-- Add status column to lessons: active, inactive, draft
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_status_check;
ALTER TABLE lessons ADD CONSTRAINT lessons_status_check 
    CHECK (status IN ('active', 'inactive', 'draft'));
UPDATE lessons SET status = 'active' WHERE status IS NULL;
ALTER TABLE lessons ALTER COLUMN status SET DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(status);
CREATE INDEX IF NOT EXISTS idx_lessons_status ON lessons(status);
