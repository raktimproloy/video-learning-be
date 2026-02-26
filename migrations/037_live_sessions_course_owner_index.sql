-- Index for teacher course-specific live report: list sessions by course and owner
CREATE INDEX IF NOT EXISTS idx_live_sessions_course_owner ON live_sessions(course_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_live_usage_records_session ON live_usage_records(live_session_id);
