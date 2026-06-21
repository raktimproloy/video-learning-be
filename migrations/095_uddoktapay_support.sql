-- Allow 'uddoktapay' as a valid payment method in addition to bkash, nagad, and rocket.
ALTER TABLE course_payment_requests DROP CONSTRAINT IF EXISTS course_payment_requests_payment_method_check;

ALTER TABLE course_payment_requests ADD CONSTRAINT course_payment_requests_payment_method_check
    CHECK (payment_method IN ('bkash', 'nagad', 'rocket', 'uddoktapay'));
