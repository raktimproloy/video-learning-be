-- Course books: multiple books per course, dual pricing, processing status
-- Additive feature — courses with no books behave as before.

CREATE TABLE IF NOT EXISTS course_books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    cover_path TEXT,
    master_pdf_r2_key TEXT,
    total_pages INT DEFAULT 0,
    preview_page_count INT NOT NULL DEFAULT 3 CHECK (preview_page_count >= 0 AND preview_page_count <= 5),
    delivery_mode TEXT NOT NULL DEFAULT 'pdf_only'
        CHECK (delivery_mode IN ('pdf_only', 'courier_only', 'both')),
    pricing_mode TEXT NOT NULL DEFAULT 'addon'
        CHECK (pricing_mode IN ('included', 'addon', 'free_with_course')),
    addon_price NUMERIC(12, 2) DEFAULT 0 CHECK (addon_price IS NULL OR addon_price >= 0),
    courier_fee NUMERIC(12, 2) DEFAULT 0 CHECK (courier_fee IS NULL OR courier_fee >= 0),
    courier_fee_paid_by TEXT DEFAULT 'student'
        CHECK (courier_fee_paid_by IN ('student', 'teacher')),
    stock_limit INT,
    stock_remaining INT,
    sort_order INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'suspended')),
    processing_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed')),
    processing_error TEXT,
    currency TEXT DEFAULT 'BDT',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_books_course_id ON course_books(course_id);
CREATE INDEX IF NOT EXISTS idx_course_books_teacher_id ON course_books(teacher_id);
CREATE INDEX IF NOT EXISTS idx_course_books_status ON course_books(status);
CREATE INDEX IF NOT EXISTS idx_course_books_processing ON course_books(processing_status);

-- Course-level dual pricing (course only vs course + all books)
CREATE TABLE IF NOT EXISTS course_book_pricing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL UNIQUE REFERENCES courses(id) ON DELETE CASCADE,
    dual_pricing_enabled BOOLEAN NOT NULL DEFAULT false,
    price_without_books NUMERIC(12, 2),
    price_with_all_books NUMERIC(12, 2),
    pricing_snapshot JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION course_books_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_course_books_updated_at ON course_books;
CREATE TRIGGER trigger_course_books_updated_at
    BEFORE UPDATE ON course_books
    FOR EACH ROW EXECUTE FUNCTION course_books_updated_at();

DROP TRIGGER IF EXISTS trigger_course_book_pricing_updated_at ON course_book_pricing;
CREATE TRIGGER trigger_course_book_pricing_updated_at
    BEFORE UPDATE ON course_book_pricing
    FOR EACH ROW EXECUTE FUNCTION course_books_updated_at();
