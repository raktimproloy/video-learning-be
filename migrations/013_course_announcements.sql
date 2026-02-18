-- Course announcements: teachers post to a course; students enrolled in that course see them as notifications.
CREATE TABLE IF NOT EXISTS course_announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_announcements_course_id ON course_announcements(course_id);
CREATE INDEX IF NOT EXISTS idx_course_announcements_teacher_id ON course_announcements(teacher_id);
CREATE INDEX IF NOT EXISTS idx_course_announcements_created_at ON course_announcements(created_at DESC);

-- Tracks which user has read which announcement (for notification "read" state).
CREATE TABLE IF NOT EXISTS announcement_reads (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    announcement_id UUID NOT NULL REFERENCES course_announcements(id) ON DELETE CASCADE,
    read_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, announcement_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_user_id ON announcement_reads(user_id);
