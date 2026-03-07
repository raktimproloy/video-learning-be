-- Teacher reviews: students review a teacher (not a course).
-- Rules: student role only, at least 2 courses purchased from this teacher, cannot review self.
CREATE TABLE IF NOT EXISTS teacher_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_reviews_teacher_id ON teacher_reviews(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_reviews_user_id ON teacher_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_teacher_reviews_created_at ON teacher_reviews(created_at DESC);

COMMENT ON TABLE teacher_reviews IS 'Student reviews for teachers. One review per student per teacher.';
