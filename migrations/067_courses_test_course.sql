-- Core-member test courses: hide from public course listings/search.
-- Such courses remain purchasable via invite code/link.

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS test_course BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_courses_test_course ON courses(test_course);
