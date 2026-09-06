-- Admin "social proof" tooling:
--  * course_enrollments.is_dummy  -> admin-seeded enrollment. Counts toward the
--    PUBLIC purchase/student count only. Hidden from every teacher-facing view
--    (students list, revenue, withdrawable, dashboard, sales history).
--  * videos.view_boost           -> admin-set padding added to a RECORDED video's
--    displayed view count. Real view_count is never touched, so it is fully
--    reversible (set boost back to 0). Not allowed on live videos.

ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS is_dummy BOOLEAN NOT NULL DEFAULT false;

-- Partial index so the "real students only" filter stays cheap on hot teacher paths.
CREATE INDEX IF NOT EXISTS idx_course_enrollments_real
    ON course_enrollments (course_id)
    WHERE is_dummy = false;

ALTER TABLE videos ADD COLUMN IF NOT EXISTS view_boost INTEGER NOT NULL DEFAULT 0;

-- Backfill: any enrollment already created by the admin dummy/seed tooling
-- (email dummy-<hex>@admin-seed.local) becomes a proper hidden dummy row with
-- zero revenue impact.
UPDATE course_enrollments ce
SET is_dummy = true,
    amount_paid = 0
FROM users u
WHERE ce.user_id = u.id
  AND u.email LIKE 'dummy-%@admin-seed.local'
  AND ce.is_dummy = false;
