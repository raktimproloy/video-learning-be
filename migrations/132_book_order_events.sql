-- Migration 132: Audit timeline for book courier orders

CREATE TABLE IF NOT EXISTS book_courier_order_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES book_courier_orders(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    status TEXT,
    message TEXT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_book_courier_order_events_order
    ON book_courier_order_events(order_id, created_at ASC);

-- Backfill: order created
INSERT INTO book_courier_order_events (order_id, event_type, status, message, created_at)
SELECT bco.id, 'order_created', bco.status, 'Order placed', bco.created_at
FROM book_courier_orders bco
WHERE NOT EXISTS (
    SELECT 1 FROM book_courier_order_events e
    WHERE e.order_id = bco.id AND e.event_type = 'order_created'
);

-- Backfill: payment submitted
INSERT INTO book_courier_order_events (order_id, event_type, status, message, meta, created_at)
SELECT bco.id, 'payment_submitted', pr.status,
       'Payment submitted — awaiting verification',
       jsonb_build_object(
           'paymentRequestId', pr.id,
           'amount', pr.amount,
           'currency', pr.currency,
           'paymentMethod', pr.payment_method
       ),
       pr.created_at
FROM book_courier_orders bco
JOIN course_payment_requests pr ON pr.id = bco.payment_request_id
WHERE NOT EXISTS (
    SELECT 1 FROM book_courier_order_events e
    WHERE e.order_id = bco.id AND e.event_type = 'payment_submitted'
);

-- Backfill: payment accepted
INSERT INTO book_courier_order_events (order_id, event_type, status, message, meta, created_at)
SELECT bco.id, 'payment_accepted', 'paid',
       'Payment verified and accepted',
       jsonb_build_object(
           'paymentRequestId', pr.id,
           'amount', pr.amount,
           'currency', pr.currency,
           'transactionId', pr.transaction_id
       ),
       COALESCE(pr.reviewed_at, pr.updated_at, bco.updated_at)
FROM book_courier_orders bco
JOIN course_payment_requests pr ON pr.id = bco.payment_request_id
WHERE bco.payment_status = 'paid'
  AND pr.status = 'accepted'
  AND NOT EXISTS (
    SELECT 1 FROM book_courier_order_events e
    WHERE e.order_id = bco.id AND e.event_type = 'payment_accepted'
);

-- Backfill: address locked
INSERT INTO book_courier_order_events (order_id, event_type, status, message, created_at)
SELECT bco.id, 'address_locked', bco.status, 'Delivery address locked', bco.address_locked_at
FROM book_courier_orders bco
WHERE bco.address_locked_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM book_courier_order_events e
    WHERE e.order_id = bco.id AND e.event_type = 'address_locked'
);

-- Backfill: latest status snapshot when order was updated after creation
INSERT INTO book_courier_order_events (order_id, event_type, status, message, created_at)
SELECT bco.id, 'status_updated', bco.status,
       'Status: ' || replace(bco.status, '_', ' '),
       bco.updated_at
FROM book_courier_orders bco
WHERE bco.updated_at > bco.created_at + interval '1 second'
  AND NOT EXISTS (
    SELECT 1 FROM book_courier_order_events e
    WHERE e.order_id = bco.id
      AND e.event_type = 'status_updated'
      AND e.status = bco.status
      AND e.created_at = bco.updated_at
);
