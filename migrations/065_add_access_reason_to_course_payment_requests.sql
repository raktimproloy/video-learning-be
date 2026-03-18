-- Store the admin-provided reason when they grant/re-approve access after reviewing a payment request.
ALTER TABLE course_payment_requests
ADD COLUMN IF NOT EXISTS acceptance_reason TEXT;

