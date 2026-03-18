-- Add rejection_reason column to store why an admin rejected a payment request
ALTER TABLE course_payment_requests
ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

