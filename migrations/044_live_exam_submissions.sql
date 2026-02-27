-- Student submissions for live exams (MCQ)
CREATE TABLE IF NOT EXISTS live_exam_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID NOT NULL REFERENCES live_exams(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    total_questions INTEGER NOT NULL,
    correct_count INTEGER NOT NULL,
    time_taken_ms INTEGER NOT NULL,
    answers JSONB NOT NULL DEFAULT '[]'::jsonb,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_exam_submissions_exam ON live_exam_submissions(exam_id);
CREATE INDEX IF NOT EXISTS idx_live_exam_submissions_exam_score ON live_exam_submissions(exam_id, score DESC, time_taken_ms ASC);

