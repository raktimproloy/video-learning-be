-- Public exams can be taken without enrollment (excluded from leaderboard when not enrolled).
-- Required exams gate unlocking the next video/lesson (like required assignments).
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN exams.is_public IS 'When true, non-enrolled students can view/take; they are omitted from leaderboard until enrolled.';
COMMENT ON COLUMN exams.is_required IS 'When true, student must submit this exam before next video/lesson unlocks.';
