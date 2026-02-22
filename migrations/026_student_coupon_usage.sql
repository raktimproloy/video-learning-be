-- Tracks when a student applies/uses a coupon. One-time use per student per coupon.
CREATE TABLE IF NOT EXISTS student_coupon_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    coupon_type TEXT NOT NULL CHECK (coupon_type IN ('admin', 'teacher')),
    coupon_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (student_id, coupon_type, coupon_id)
);

CREATE INDEX IF NOT EXISTS idx_student_coupon_usage_student ON student_coupon_usage(student_id);
CREATE INDEX IF NOT EXISTS idx_student_coupon_usage_coupon ON student_coupon_usage(coupon_type, coupon_id);
