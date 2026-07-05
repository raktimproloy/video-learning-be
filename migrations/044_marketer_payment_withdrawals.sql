-- Marketer payment methods: bank, card, bkash, nagad, rocket
CREATE TABLE IF NOT EXISTS marketer_payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketer_id UUID NOT NULL REFERENCES marketers(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('bank','card','bkash','nagad','rocket')),
    display_label VARCHAR(255) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketer_payment_methods_marketer_id ON marketer_payment_methods(marketer_id);

-- Marketer withdraw requests: pending -> accepted (with receipt) or rejected (with reason)
CREATE TABLE IF NOT EXISTS marketer_withdraw_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    payment_method_id UUID REFERENCES marketer_payment_methods(id) ON DELETE SET NULL,
    payment_method_snapshot JSONB NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
    receipt_image_path TEXT NULL,
    rejection_reason TEXT NULL,
    reviewed_at TIMESTAMP NULL,
    reviewed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketer_withdraw_requests_marketer_id ON marketer_withdraw_requests(marketer_id);
CREATE INDEX IF NOT EXISTS idx_marketer_withdraw_requests_status ON marketer_withdraw_requests(status);

COMMENT ON TABLE marketer_payment_methods IS 'Marketer payout methods: bank account, card, bKash, Nagad, Rocket';
COMMENT ON TABLE marketer_withdraw_requests IS 'Marketer withdrawal requests; on accept admin uploads receipt';
