-- Store actual amount paid per enrollment (e.g. after coupon discount) for correct teacher revenue.
-- NULL amount_paid = legacy enrollment; revenue logic falls back to course price/discount_price.
ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) NULL;
ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NULL;

COMMENT ON COLUMN course_enrollments.amount_paid IS 'Actual amount paid by student (after coupon etc.). NULL = use course price for revenue.';
COMMENT ON COLUMN course_enrollments.currency IS 'Currency of amount_paid. NULL = use course currency.';
