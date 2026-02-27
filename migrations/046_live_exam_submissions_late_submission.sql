-- Late submissions (e.g. after watching saved replay) are saved but excluded from leaderboard
ALTER TABLE live_exam_submissions
  ADD COLUMN IF NOT EXISTS late_submission BOOLEAN NOT NULL DEFAULT FALSE;
