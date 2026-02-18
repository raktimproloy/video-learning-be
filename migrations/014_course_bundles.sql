-- Course bundles: teacher creates a bundle of their courses with a combined price.
CREATE TABLE IF NOT EXISTS course_bundles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    main_price DECIMAL(10, 2) NOT NULL,
    discount_price DECIMAL(10, 2),
    currency TEXT DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_bundles_teacher_id ON course_bundles(teacher_id);

-- Which courses belong to a bundle (many-to-many).
CREATE TABLE IF NOT EXISTS bundle_courses (
    bundle_id UUID NOT NULL REFERENCES course_bundles(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    PRIMARY KEY (bundle_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_bundle_courses_bundle_id ON bundle_courses(bundle_id);
CREATE INDEX IF NOT EXISTS idx_bundle_courses_course_id ON bundle_courses(course_id);
