-- Coupon usage limits: max uses per user (default 1), max total uses (null = unlimited).
-- Teacher coupon applies only to that teacher's courses; admin coupon applies to every course.
-- Allow multiple uses per user per coupon (for max_uses_per_user > 1).

-- Admin coupons: add usage limit columns
ALTER TABLE admin_coupons
    ADD COLUMN IF NOT EXISTS max_uses_per_user INT NOT NULL DEFAULT 1 CHECK (max_uses_per_user >= 1 AND max_uses_per_user <= 100),
    ADD COLUMN IF NOT EXISTS max_total_uses INT NULL CHECK (max_total_uses IS NULL OR max_total_uses >= 1);

-- Teacher coupons: add usage limit columns
ALTER TABLE teacher_coupons
    ADD COLUMN IF NOT EXISTS max_uses_per_user INT NOT NULL DEFAULT 1 CHECK (max_uses_per_user >= 1 AND max_uses_per_user <= 100),
    ADD COLUMN IF NOT EXISTS max_total_uses INT NULL CHECK (max_total_uses IS NULL OR max_total_uses >= 1);

-- Allow multiple rows per student per coupon (for max_uses_per_user > 1)
ALTER TABLE student_coupon_usage DROP CONSTRAINT IF EXISTS student_coupon_usage_student_id_coupon_type_coupon_id_key;

-- Index for counting total uses per coupon
CREATE INDEX IF NOT EXISTS idx_student_coupon_usage_coupon_count ON student_coupon_usage(coupon_type, coupon_id);
-- Index for counting uses per student per coupon
CREATE INDEX IF NOT EXISTS idx_student_coupon_usage_student_coupon ON student_coupon_usage(student_id, coupon_type, coupon_id);
