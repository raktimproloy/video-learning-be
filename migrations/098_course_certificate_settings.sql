-- Add Certificate settings and criteria to courses table
ALTER TABLE courses
ADD COLUMN IF NOT EXISTS is_certificate_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS certificate_design TEXT DEFAULT 'default',
ADD COLUMN IF NOT EXISTS certificate_criteria JSONB DEFAULT '{
  "videos": { "required": true },
  "assignments": { "type": "submit_all", "min_marks_percent": 0 },
  "exams": { "type": "min_marks", "min_marks_percent": 80 }
}'::jsonb;
