-- External URL courses: metadata + outbound links (no in-platform lessons).
-- course_type 'external' keeps internal lesson/video flows unchanged.

-- Relax course_type check to include 'external'
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_course_type_check;
ALTER TABLE courses
  ADD CONSTRAINT courses_course_type_check
  CHECK (
    course_type IS NULL
    OR course_type = ANY (ARRAY['lesson-based'::text, 'video-based'::text, 'external'::text])
  );

ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_url TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_intro_video_url TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_whatsapp TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_phone TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS price_display_period TEXT
  CHECK (price_display_period IS NULL OR price_display_period = ANY (ARRAY['monthly'::text, 'yearly'::text, 'one_time'::text]));
ALTER TABLE courses ADD COLUMN IF NOT EXISTS visitor_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE courses ADD CONSTRAINT courses_visitor_count_nonnegative CHECK (visitor_count >= 0);

CREATE INDEX IF NOT EXISTS idx_courses_course_type_external ON courses (course_type) WHERE course_type = 'external';

COMMENT ON COLUMN courses.external_url IS 'Primary outbound URL for external-hosted course content.';
COMMENT ON COLUMN courses.visitor_count IS 'Click-through / visitor count (see external-click API).';
COMMENT ON COLUMN courses.price_display_period IS 'How the display price should be read: monthly, yearly, or one_time.';
