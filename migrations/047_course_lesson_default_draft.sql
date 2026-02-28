-- Default status to 'draft' for new courses and lessons (professional flow: teacher publishes when ready)
-- Existing rows are unchanged. Only new INSERTs get status = 'draft' by default.

ALTER TABLE courses ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE lessons ALTER COLUMN status SET DEFAULT 'draft';
