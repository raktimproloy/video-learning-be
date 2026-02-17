-- Add status, marks, graded_by, graded_at to assignment_submissions
-- status: pending (submitted, awaiting review), passed, failed

ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS marks TEXT;
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS graded_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS graded_at TIMESTAMP;

UPDATE assignment_submissions SET status = 'pending' WHERE status IS NULL;
ALTER TABLE assignment_submissions ALTER COLUMN status SET NOT NULL;
ALTER TABLE assignment_submissions ALTER COLUMN status SET DEFAULT 'pending';

-- Add check constraint only if not exists (optional, for data integrity)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_assignment_submissions_status'
  ) THEN
    ALTER TABLE assignment_submissions ADD CONSTRAINT chk_assignment_submissions_status
      CHECK (status IN ('pending', 'passed', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assignment_submissions_status ON assignment_submissions(status);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_graded_by ON assignment_submissions(graded_by);
