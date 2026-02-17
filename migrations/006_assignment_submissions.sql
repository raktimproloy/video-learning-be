-- Assignment submissions: student_id, assignment ref (video/lesson), file_path, etc.

CREATE TABLE IF NOT EXISTS assignment_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assignment_type TEXT NOT NULL CHECK (assignment_type IN ('video', 'lesson')),
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE,
    assignment_id TEXT NOT NULL,
    file_path TEXT,
    file_name TEXT,
    submitted_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT chk_video_or_lesson CHECK (
        (assignment_type = 'video' AND video_id IS NOT NULL AND lesson_id IS NULL) OR
        (assignment_type = 'lesson' AND lesson_id IS NOT NULL AND video_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_assignment_submissions_user ON assignment_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_video ON assignment_submissions(video_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_lesson ON assignment_submissions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_composite ON assignment_submissions(user_id, assignment_type, COALESCE(video_id::text, lesson_id::text), assignment_id);
