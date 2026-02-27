-- Store when exam was published and visibility countdown (seconds) in exam data
ALTER TABLE live_exams
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS visibility_countdown_seconds INTEGER NOT NULL DEFAULT 10;

-- One submission per student per exam: remove duplicates first (keep one per exam_id, student_id by earliest submitted_at, then lowest id)
DELETE FROM live_exam_submissions
WHERE id NOT IN (
  SELECT DISTINCT ON (exam_id, student_id) id
  FROM live_exam_submissions
  ORDER BY exam_id, student_id, submitted_at ASC, id ASC
);

-- Now create the unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_exam_submissions_exam_student
  ON live_exam_submissions(exam_id, student_id);
