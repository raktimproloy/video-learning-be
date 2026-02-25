-- Course payment requests: student submits payment details; admin accepts/rejects and enrollment happens on accept.
CREATE TABLE IF NOT EXISTS course_payment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('bkash', 'nagad', 'rocket')),
    sender_phone TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'BDT',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    coupon_code TEXT,
    invite_code TEXT,
    reviewed_at TIMESTAMP,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_payment_requests_course_id ON course_payment_requests(course_id);
CREATE INDEX IF NOT EXISTS idx_course_payment_requests_user_id ON course_payment_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_course_payment_requests_status ON course_payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_course_payment_requests_created_at ON course_payment_requests(created_at DESC);
