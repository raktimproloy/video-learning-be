-- 1. Add marketer_profiles
CREATE TABLE IF NOT EXISTS marketer_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    referral_code TEXT UNIQUE NOT NULL,
    total_earnings NUMERIC(10, 2) DEFAULT 0,
    withdrawn_amount NUMERIC(10, 2) DEFAULT 0,
    payment_methods JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketer_profiles_referral_code ON marketer_profiles(referral_code);

-- 2. Add referred_by to teacher_profiles
ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- 3. Add reference share settings to admin_share_settings
ALTER TABLE admin_share_settings ADD COLUMN IF NOT EXISTS reference_percent NUMERIC(5, 2) NOT NULL DEFAULT 10 CHECK (reference_percent >= 0 AND reference_percent <= 100);
ALTER TABLE admin_share_settings ADD COLUMN IF NOT EXISTS reference_teacher_percent NUMERIC(5, 2) NOT NULL DEFAULT 40 CHECK (reference_teacher_percent >= 0 AND reference_teacher_percent <= 100);

-- 4. Course Sales Commisions tracking
CREATE TABLE IF NOT EXISTS course_commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    student_id UUID REFERENCES users(id) ON DELETE SET NULL,
    teacher_id UUID REFERENCES users(id) ON DELETE SET NULL,
    marketer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    amount_paid NUMERIC(10, 2) NOT NULL,
    site_commission NUMERIC(10, 2) NOT NULL,
    teacher_commission NUMERIC(10, 2) NOT NULL,
    marketer_commission NUMERIC(10, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Course suspend status constraint adjustment
ALTER TABLE courses ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'draft', 'suspend'));

-- Triggers for updated_at on marketer_profiles
CREATE OR REPLACE FUNCTION marketer_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_marketer_profiles_updated_at ON marketer_profiles;
CREATE TRIGGER trigger_marketer_profiles_updated_at
    BEFORE UPDATE ON marketer_profiles
    FOR EACH ROW EXECUTE FUNCTION marketer_profiles_updated_at();
