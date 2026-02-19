-- Live stream: chat persistence, notes/assignments, watch tracking, timer
-- Add live_started_at for elapsed timer
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS live_started_at TIMESTAMPTZ;
-- Set when is_live becomes true, clear when false
CREATE INDEX IF NOT EXISTS idx_lessons_live_started ON lessons(live_started_at) WHERE live_started_at IS NOT NULL;

-- Live chat messages (persisted for reload)
CREATE TABLE IF NOT EXISTS live_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_type TEXT NOT NULL CHECK (user_type IN ('teacher', 'student')),
    user_display_name TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_chat_lesson ON live_chat_messages(lesson_id);
CREATE INDEX IF NOT EXISTS idx_live_chat_created ON live_chat_messages(lesson_id, created_at);

-- Live materials (notes and assignments added during live - text and/or images)
CREATE TABLE IF NOT EXISTS live_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('note', 'assignment')),
    content TEXT,
    file_path TEXT,
    file_name TEXT,
    is_required BOOLEAN DEFAULT false,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_materials_lesson ON live_materials(lesson_id);

-- Live watch records (which students watched, for how long; one row per join session)
CREATE TABLE IF NOT EXISTS live_watch_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    watch_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_live_watch_lesson ON live_watch_records(lesson_id);
CREATE INDEX IF NOT EXISTS idx_live_watch_student ON live_watch_records(student_id);
