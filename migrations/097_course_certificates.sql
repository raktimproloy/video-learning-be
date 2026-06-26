-- Course completion certificates (Udemy-style)
CREATE TABLE IF NOT EXISTS course_certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    certificate_number VARCHAR(32) NOT NULL UNIQUE,
    student_name TEXT NOT NULL,
    course_title TEXT NOT NULL,
    instructor_name TEXT,
    issued_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_course_certificates_user_id ON course_certificates(user_id);
CREATE INDEX IF NOT EXISTS idx_course_certificates_course_id ON course_certificates(course_id);
CREATE INDEX IF NOT EXISTS idx_course_certificates_number ON course_certificates(certificate_number);
