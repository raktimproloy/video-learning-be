-- Live class requests: teachers request to enable live class for a course; admin accepts or declines.
-- Once a course has has_live_class = true (from creation or after approval), it cannot be turned off.
CREATE TABLE IF NOT EXISTS live_class_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_live_class_requests_course_id ON live_class_requests(course_id);
CREATE INDEX IF NOT EXISTS idx_live_class_requests_status ON live_class_requests(status);
CREATE INDEX IF NOT EXISTS idx_live_class_requests_created_at ON live_class_requests(created_at DESC);
-- Only one pending request per course at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_class_requests_one_pending_per_course ON live_class_requests(course_id) WHERE status = 'pending';

COMMENT ON TABLE live_class_requests IS 'Teacher requests to enable live class for a course; one pending request per course.';
