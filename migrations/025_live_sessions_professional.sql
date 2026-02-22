-- Live sessions: unique ID per live, becomes video_id when saved
-- Professional design: every live generates an ID at start; on save, that ID is the video ID

-- Live sessions table: one row per live stream
CREATE TABLE IF NOT EXISTS live_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    live_name TEXT,
    live_order INTEGER DEFAULT 0,
    live_description TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'saved', 'discarded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_sessions_lesson ON live_sessions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_live_sessions_status ON live_sessions(status) WHERE status = 'active';

-- Link lessons to current active live session
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS current_live_session_id UUID REFERENCES live_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lessons_current_live_session ON lessons(current_live_session_id) WHERE current_live_session_id IS NOT NULL;

-- Associate chat messages with live session
ALTER TABLE live_chat_messages ADD COLUMN IF NOT EXISTS live_session_id UUID REFERENCES live_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_live_chat_session ON live_chat_messages(live_session_id) WHERE live_session_id IS NOT NULL;

-- Associate materials with live session
ALTER TABLE live_materials ADD COLUMN IF NOT EXISTS live_session_id UUID REFERENCES live_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_live_materials_session ON live_materials(live_session_id) WHERE live_session_id IS NOT NULL;

-- Live watch records: associate with live session
ALTER TABLE live_watch_records ADD COLUMN IF NOT EXISTS live_session_id UUID REFERENCES live_sessions(id) ON DELETE SET NULL;
