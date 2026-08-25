-- Book commissions (separate from course_commissions) + extend payment requests

CREATE TABLE IF NOT EXISTS book_commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_book_id UUID NOT NULL REFERENCES course_books(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payment_request_id UUID REFERENCES course_payment_requests(id) ON DELETE SET NULL,
    entitlement_id UUID REFERENCES book_entitlements(id) ON DELETE SET NULL,
    book_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    platform_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
    platform_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    teacher_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'BDT',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_book_commissions_teacher ON book_commissions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_book_commissions_book ON book_commissions(course_book_id);
CREATE INDEX IF NOT EXISTS idx_book_commissions_student ON book_commissions(student_id);

-- Extend course_payment_requests (nullable / defaults — safe for existing rows)
ALTER TABLE course_payment_requests
    ADD COLUMN IF NOT EXISTS purchase_type TEXT DEFAULT 'course_only';

ALTER TABLE course_payment_requests
    ADD COLUMN IF NOT EXISTS book_items JSONB DEFAULT '[]'::jsonb;

ALTER TABLE course_payment_requests
    ADD COLUMN IF NOT EXISTS course_amount NUMERIC(12, 2);

ALTER TABLE course_payment_requests
    ADD COLUMN IF NOT EXISTS book_amount NUMERIC(12, 2);

-- Backfill + constraint for purchase_type
UPDATE course_payment_requests
SET purchase_type = 'course_only'
WHERE purchase_type IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'course_payment_requests_purchase_type_check'
    ) THEN
        ALTER TABLE course_payment_requests
            ADD CONSTRAINT course_payment_requests_purchase_type_check
            CHECK (purchase_type IN ('course_only', 'course_with_books', 'book_addon'));
    END IF;
END $$;
