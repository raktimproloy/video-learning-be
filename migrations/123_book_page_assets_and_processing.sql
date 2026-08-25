-- Rasterized page images + async processing queue (mirror video_processing_tasks)

CREATE TABLE IF NOT EXISTS book_page_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_book_id UUID NOT NULL REFERENCES course_books(id) ON DELETE CASCADE,
    page_index INT NOT NULL CHECK (page_index >= 0),
    r2_key TEXT NOT NULL,
    width INT,
    height INT,
    is_preview BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (course_book_id, page_index)
);

CREATE INDEX IF NOT EXISTS idx_book_page_assets_book ON book_page_assets(course_book_id);
CREATE INDEX IF NOT EXISTS idx_book_page_assets_preview ON book_page_assets(course_book_id, is_preview)
    WHERE is_preview = true;

CREATE TABLE IF NOT EXISTS book_processing_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_book_id UUID NOT NULL REFERENCES course_books(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    processing_stage TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_book_processing_tasks_status ON book_processing_tasks(status)
    WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_book_processing_tasks_book ON book_processing_tasks(course_book_id);

CREATE OR REPLACE FUNCTION book_processing_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_book_processing_tasks_updated_at ON book_processing_tasks;
CREATE TRIGGER trigger_book_processing_tasks_updated_at
    BEFORE UPDATE ON book_processing_tasks
    FOR EACH ROW EXECUTE FUNCTION book_processing_tasks_updated_at();
