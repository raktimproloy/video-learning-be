-- Migration 129: Courier Settings and Limits

-- Add max courier orders per student
ALTER TABLE course_books
    ADD COLUMN IF NOT EXISTS max_courier_orders_per_student INT DEFAULT 1;

-- Add support for multiple courier pricing options
ALTER TABLE course_books
    ADD COLUMN IF NOT EXISTS courier_fees JSONB DEFAULT '[]'::jsonb;

-- Add tracking for paid courier fees in courier orders
ALTER TABLE book_courier_orders
    ADD COLUMN IF NOT EXISTS selected_courier_fee_name TEXT,
    ADD COLUMN IF NOT EXISTS courier_fee_amount NUMERIC(12, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS book_price_amount NUMERIC(12, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_request_id UUID REFERENCES course_payment_requests(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'paid', 'not_required'));

-- Update existing records: migrate the old `courier_fee` (numeric) into the new JSONB structure if it > 0
UPDATE course_books
SET courier_fees = jsonb_build_array(
    jsonb_build_object('name', 'Standard', 'fee', courier_fee)
)
WHERE courier_fee > 0 AND (courier_fees IS NULL OR jsonb_array_length(courier_fees) = 0);
