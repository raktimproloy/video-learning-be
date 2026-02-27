-- Live exams (MCQ) attached to a lesson / live session
CREATE TABLE IF NOT EXISTS live_exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    live_session_id UUID NULL REFERENCES live_sessions(id) ON DELETE SET NULL,
    title TEXT,
    time_limit_minutes INTEGER,
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_exams_lesson ON live_exams(lesson_id);
CREATE INDEX IF NOT EXISTS idx_live_exams_status ON live_exams(lesson_id, status);

