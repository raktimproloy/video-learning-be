-- Teacher payment methods: bank, card, bkash, nagad, rocket (one table for all, selectable for withdraw)
CREATE TABLE IF NOT EXISTS teacher_payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('bank','card','bkash','nagad','rocket')),
    display_label VARCHAR(255) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_teacher_payment_methods_teacher_id ON teacher_payment_methods(teacher_id);

-- Teacher withdraw requests: pending -> accepted (with receipt) or rejected (with reason)
CREATE TABLE IF NOT EXISTS teacher_withdraw_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    payment_method_id UUID REFERENCES teacher_payment_methods(id) ON DELETE SET NULL,
    payment_method_snapshot JSONB NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
    receipt_image_path TEXT NULL,
    rejection_reason TEXT NULL,
    reviewed_at TIMESTAMP NULL,
    reviewed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_teacher_withdraw_requests_teacher_id ON teacher_withdraw_requests(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_withdraw_requests_status ON teacher_withdraw_requests(status);

COMMENT ON TABLE teacher_payment_methods IS 'Teacher payout methods: bank account, card, bKash, Nagad, Rocket';
COMMENT ON TABLE teacher_withdraw_requests IS 'Teacher withdrawal requests; on accept admin uploads receipt; withdrawable balance excludes accepted amounts';
