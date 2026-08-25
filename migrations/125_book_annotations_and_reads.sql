-- Student private annotations (highlights / sticky notes) + light read analytics

CREATE TABLE IF NOT EXISTS book_user_annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_book_id UUID NOT NULL REFERENCES course_books(id) ON DELETE CASCADE,
    page_index INT NOT NULL CHECK (page_index >= 0),
    type TEXT NOT NULL CHECK (type IN ('highlight', 'note')),
    rect JSONB NOT NULL DEFAULT '{}'::jsonb,
    color TEXT DEFAULT '#FBBF24',
    note_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_book_user_annotations_user_book
    ON book_user_annotations(user_id, course_book_id);
CREATE INDEX IF NOT EXISTS idx_book_user_annotations_page
    ON book_user_annotations(course_book_id, page_index);

CREATE TABLE IF NOT EXISTS book_read_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_book_id UUID NOT NULL REFERENCES course_books(id) ON DELETE CASCADE,
    page_index INT NOT NULL,
    at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_book_read_events_user_book
    ON book_read_events(user_id, course_book_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_book_read_events_book_at
    ON book_read_events(course_book_id, at DESC);

CREATE OR REPLACE FUNCTION book_user_annotations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_book_user_annotations_updated_at ON book_user_annotations;
CREATE TRIGGER trigger_book_user_annotations_updated_at
    BEFORE UPDATE ON book_user_annotations
    FOR EACH ROW EXECUTE FUNCTION book_user_annotations_updated_at();
