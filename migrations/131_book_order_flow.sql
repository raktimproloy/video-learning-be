-- Migration 131: Book order flow — quantity, pending_payment, purchase_type, notification link

-- Quantity of physical copies per courier order
ALTER TABLE book_courier_orders
    ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'book_courier_orders_quantity_check'
    ) THEN
        ALTER TABLE book_courier_orders
            ADD CONSTRAINT book_courier_orders_quantity_check CHECK (quantity >= 1);
    END IF;
END $$;

-- Extend courier order status to include pending_payment
ALTER TABLE book_courier_orders DROP CONSTRAINT IF EXISTS book_courier_orders_status_check;
ALTER TABLE book_courier_orders
    ADD CONSTRAINT book_courier_orders_status_check
    CHECK (status IN (
        'pending_payment',
        'pending_address',
        'submitted',
        'processing',
        'shipped',
        'delivered',
        'cancelled'
    ));

-- Fix / extend purchase_type CHECK for courier_fee and book_courier
ALTER TABLE course_payment_requests DROP CONSTRAINT IF EXISTS course_payment_requests_purchase_type_check;
ALTER TABLE course_payment_requests
    ADD CONSTRAINT course_payment_requests_purchase_type_check
    CHECK (purchase_type IN (
        'course_only',
        'course_with_books',
        'book_addon',
        'courier_fee',
        'book_courier'
    ));

-- Deep-link support for notifications (e.g. book order status)
ALTER TABLE user_notifications
    ADD COLUMN IF NOT EXISTS link TEXT;

CREATE INDEX IF NOT EXISTS idx_book_courier_orders_student_book
    ON book_courier_orders(student_id, course_book_id);

CREATE INDEX IF NOT EXISTS idx_book_courier_orders_student_active
    ON book_courier_orders(student_id, status)
    WHERE status NOT IN ('delivered', 'cancelled');
