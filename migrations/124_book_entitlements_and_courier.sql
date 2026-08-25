-- Access control + courier fulfillment for course books

CREATE TABLE IF NOT EXISTS book_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    course_book_id UUID NOT NULL REFERENCES course_books(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'purchase'
        CHECK (source IN ('purchase', 'gift', 'admin')),
    has_pdf BOOLEAN NOT NULL DEFAULT true,
    has_courier BOOLEAN NOT NULL DEFAULT false,
    purchase_blocked BOOLEAN NOT NULL DEFAULT true,
    payment_request_id UUID REFERENCES course_payment_requests(id) ON DELETE SET NULL,
    price_snapshot JSONB DEFAULT '{}'::jsonb,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, course_book_id)
);

CREATE INDEX IF NOT EXISTS idx_book_entitlements_user ON book_entitlements(user_id);
CREATE INDEX IF NOT EXISTS idx_book_entitlements_book ON book_entitlements(course_book_id);
CREATE INDEX IF NOT EXISTS idx_book_entitlements_course ON book_entitlements(course_id);
CREATE INDEX IF NOT EXISTS idx_book_entitlements_active ON book_entitlements(user_id, course_book_id)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS book_courier_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entitlement_id UUID NOT NULL REFERENCES book_entitlements(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_book_id UUID NOT NULL REFERENCES course_books(id) ON DELETE CASCADE,
    full_name TEXT,
    phone TEXT,
    alt_phone TEXT,
    address_line TEXT,
    district TEXT,
    area TEXT,
    postal_code TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending_address'
        CHECK (status IN (
            'pending_address', 'submitted', 'processing', 'shipped', 'delivered', 'cancelled'
        )),
    tracking_number TEXT,
    teacher_note TEXT,
    cancelled_reason TEXT,
    address_locked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_book_courier_orders_teacher ON book_courier_orders(teacher_id);
CREATE INDEX IF NOT EXISTS idx_book_courier_orders_student ON book_courier_orders(student_id);
CREATE INDEX IF NOT EXISTS idx_book_courier_orders_status ON book_courier_orders(status);
CREATE INDEX IF NOT EXISTS idx_book_courier_orders_book ON book_courier_orders(course_book_id);

CREATE OR REPLACE FUNCTION book_entitlements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_book_entitlements_updated_at ON book_entitlements;
CREATE TRIGGER trigger_book_entitlements_updated_at
    BEFORE UPDATE ON book_entitlements
    FOR EACH ROW EXECUTE FUNCTION book_entitlements_updated_at();

DROP TRIGGER IF EXISTS trigger_book_courier_orders_updated_at ON book_courier_orders;
CREATE TRIGGER trigger_book_courier_orders_updated_at
    BEFORE UPDATE ON book_courier_orders
    FOR EACH ROW EXECUTE FUNCTION book_entitlements_updated_at();
