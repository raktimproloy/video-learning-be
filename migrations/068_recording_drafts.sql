-- Teacher recording drafts for draft -> edit -> publish workflow

CREATE TABLE IF NOT EXISTS recording_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | published | archived
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
  source_object_key TEXT NOT NULL,
  source_prefix TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  duration_seconds INTEGER,
  trim_start_seconds NUMERIC(10,3),
  trim_end_seconds NUMERIC(10,3),
  published_video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recording_drafts_teacher_id ON recording_drafts(teacher_id);
CREATE INDEX IF NOT EXISTS idx_recording_drafts_status ON recording_drafts(status);
CREATE INDEX IF NOT EXISTS idx_recording_drafts_created_at ON recording_drafts(created_at DESC);

