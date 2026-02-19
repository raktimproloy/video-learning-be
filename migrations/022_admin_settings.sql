-- Admin settings: share percentages, coupons, discounts
-- All tables track created_by_admin_id and updated_by_admin_id for audit

-- Share percentages (single row - platform-wide)
CREATE TABLE IF NOT EXISTS admin_share_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    our_student_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (our_student_percent >= 0 AND our_student_percent <= 100),
    teacher_student_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (teacher_student_percent >= 0 AND teacher_student_percent <= 100),
    live_courses_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (live_courses_percent >= 0 AND live_courses_percent <= 100),
    created_by_admin_id UUID REFERENCES users(id),
    updated_by_admin_id UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure single row
INSERT INTO admin_share_settings (id, our_student_percent, teacher_student_percent, live_courses_percent)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM admin_share_settings);

-- Admin coupons (platform-wide, like teacher coupons)
CREATE TABLE IF NOT EXISTS admin_coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    coupon_code TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('original', 'discount')),
    discount_type TEXT CHECK (discount_type IS NULL OR discount_type IN ('amount', 'percentage')),
    discount_amount NUMERIC(10, 2) CHECK (discount_amount IS NULL OR discount_amount >= 0),
    start_at TIMESTAMP WITH TIME ZONE,
    expire_at TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_by_admin_id UUID REFERENCES users(id),
    updated_by_admin_id UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT chk_admin_coupon_discount CHECK (
        (type = 'original') OR
        (type = 'discount' AND discount_type IN ('amount', 'percentage') AND discount_amount IS NOT NULL AND discount_amount >= 0)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_coupons_code ON admin_coupons(LOWER(TRIM(coupon_code)));
CREATE INDEX IF NOT EXISTS idx_admin_coupons_status ON admin_coupons(status);
CREATE INDEX IF NOT EXISTS idx_admin_coupons_created_at ON admin_coupons(created_at DESC);

-- Admin discounts (name, type, amount, start, end, status)
CREATE TABLE IF NOT EXISTS admin_discounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    discount_type TEXT NOT NULL CHECK (discount_type IN ('amount', 'percentage')),
    discount_amount NUMERIC(10, 2) NOT NULL CHECK (discount_amount >= 0),
    start_at TIMESTAMP WITH TIME ZONE,
    end_at TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_by_admin_id UUID REFERENCES users(id),
    updated_by_admin_id UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_discounts_status ON admin_discounts(status);
CREATE INDEX IF NOT EXISTS idx_admin_discounts_created_at ON admin_discounts(created_at DESC);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION admin_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_admin_share_settings_updated_at ON admin_share_settings;
CREATE TRIGGER trigger_admin_share_settings_updated_at
    BEFORE UPDATE ON admin_share_settings
    FOR EACH ROW EXECUTE FUNCTION admin_settings_updated_at();

DROP TRIGGER IF EXISTS trigger_admin_coupons_updated_at ON admin_coupons;
CREATE TRIGGER trigger_admin_coupons_updated_at
    BEFORE UPDATE ON admin_coupons
    FOR EACH ROW EXECUTE FUNCTION admin_settings_updated_at();

DROP TRIGGER IF EXISTS trigger_admin_discounts_updated_at ON admin_discounts;
CREATE TRIGGER trigger_admin_discounts_updated_at
    BEFORE UPDATE ON admin_discounts
    FOR EACH ROW EXECUTE FUNCTION admin_settings_updated_at();
