-- 1. Create marketers table
CREATE TABLE IF NOT EXISTS marketers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    referral_code TEXT UNIQUE NOT NULL,
    total_earnings NUMERIC(10, 2) DEFAULT 0,
    withdrawn_amount NUMERIC(10, 2) DEFAULT 0,
    payment_methods JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketers_referral_code ON marketers(referral_code);

-- 2. Migrate existing data if any
INSERT INTO marketers (id, name, email, phone, password_hash, referral_code, total_earnings, withdrawn_amount, payment_methods, created_at, updated_at)
SELECT m.user_id, m.name, u.email, m.phone, u.password_hash, m.referral_code, m.total_earnings, m.withdrawn_amount, m.payment_methods, m.created_at, m.updated_at
FROM marketer_profiles m
JOIN users u ON m.user_id = u.id
ON CONFLICT DO NOTHING;

-- 3. Reset role in users table to student for any users that were marketers
UPDATE users SET role = 'student' WHERE id IN (SELECT user_id FROM marketer_profiles);

-- 4. Update foreign keys on teacher_profiles
ALTER TABLE teacher_profiles DROP CONSTRAINT IF EXISTS teacher_profiles_referred_by_fkey;
ALTER TABLE teacher_profiles ADD CONSTRAINT teacher_profiles_referred_by_fkey FOREIGN KEY (referred_by) REFERENCES marketers(id) ON DELETE SET NULL;

-- 5. Update foreign keys on course_commissions
ALTER TABLE course_commissions DROP CONSTRAINT IF EXISTS course_commissions_marketer_id_fkey;
ALTER TABLE course_commissions ADD CONSTRAINT course_commissions_marketer_id_fkey FOREIGN KEY (marketer_id) REFERENCES marketers(id) ON DELETE SET NULL;

-- 6. Update Triggers for marketers table
CREATE OR REPLACE FUNCTION marketers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_marketers_updated_at ON marketers;
CREATE TRIGGER trigger_marketers_updated_at
    BEFORE UPDATE ON marketers
    FOR EACH ROW EXECUTE FUNCTION marketers_updated_at();

-- 7. Drop marketer_profiles
DROP TABLE IF EXISTS marketer_profiles;
