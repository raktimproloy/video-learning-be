-- Teacher coupons table
-- type: original (no expiry) | discount (with discount_type, discount_amount, start_at, expire_at)
-- coupon_code is globally unique

CREATE TABLE IF NOT EXISTS teacher_coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    coupon_code TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('original', 'discount')),
    discount_type TEXT CHECK (discount_type IS NULL OR discount_type IN ('amount', 'percentage')),
    discount_amount NUMERIC(10, 2) CHECK (discount_amount IS NULL OR discount_amount >= 0),
    start_at TIMESTAMP WITH TIME ZONE,
    expire_at TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT chk_discount_type_amount CHECK (
        (type = 'original') OR
        (type = 'discount' AND discount_type IN ('amount', 'percentage') AND discount_amount IS NOT NULL AND discount_amount >= 0)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_coupons_code ON teacher_coupons(LOWER(TRIM(coupon_code)));
CREATE INDEX IF NOT EXISTS idx_teacher_coupons_teacher_id ON teacher_coupons(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_coupons_status ON teacher_coupons(status);
CREATE INDEX IF NOT EXISTS idx_teacher_coupons_expire_at ON teacher_coupons(expire_at);
CREATE INDEX IF NOT EXISTS idx_teacher_coupons_created_at ON teacher_coupons(created_at DESC);

CREATE OR REPLACE FUNCTION teacher_coupons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_teacher_coupons_updated_at ON teacher_coupons;
CREATE TRIGGER trigger_teacher_coupons_updated_at
    BEFORE UPDATE ON teacher_coupons
    FOR EACH ROW EXECUTE FUNCTION teacher_coupons_updated_at();
