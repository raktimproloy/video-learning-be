-- Backfill missing book_commissions from accepted book payments

INSERT INTO book_commissions (
    course_book_id, course_id, teacher_id, student_id,
    payment_request_id, entitlement_id,
    book_amount, platform_percent, platform_amount, teacher_amount, currency, created_at
)
SELECT
    bco.course_book_id,
    cb.course_id,
    cb.teacher_id,
    bco.student_id,
    pr.id,
    bco.entitlement_id,
    GREATEST(
        COALESCE(bco.book_price_amount, 0) + COALESCE(bco.courier_fee_amount, 0),
        COALESCE(pr.book_amount, pr.amount, 0)
    ) AS book_amount,
    COALESCE(
        cup.custom_book_percent,
        ass.book_platform_percent,
        0
    ) AS platform_percent,
    ROUND(
        GREATEST(
            COALESCE(bco.book_price_amount, 0) + COALESCE(bco.courier_fee_amount, 0),
            COALESCE(pr.book_amount, pr.amount, 0)
        ) * COALESCE(cup.custom_book_percent, ass.book_platform_percent, 0) / 100,
        2
    ) AS platform_amount,
    ROUND(
        GREATEST(
            COALESCE(bco.book_price_amount, 0) + COALESCE(bco.courier_fee_amount, 0),
            COALESCE(pr.book_amount, pr.amount, 0)
        ) * (100 - COALESCE(cup.custom_book_percent, ass.book_platform_percent, 0)) / 100,
        2
    ) AS teacher_amount,
    COALESCE(pr.currency, 'BDT'),
    COALESCE(pr.reviewed_at, pr.created_at, NOW())
FROM course_payment_requests pr
JOIN book_courier_orders bco ON bco.payment_request_id = pr.id
JOIN course_books cb ON cb.id = bco.course_book_id
LEFT JOIN custom_user_percentages cup
    ON cup.user_type = 'teacher' AND cup.user_id = cb.teacher_id
CROSS JOIN admin_share_settings ass
WHERE ass.id = '00000000-0000-0000-0000-000000000001'::uuid
  AND pr.status = 'accepted'
  AND pr.purchase_type IN ('book_courier', 'courier_fee')
  AND GREATEST(
        COALESCE(bco.book_price_amount, 0) + COALESCE(bco.courier_fee_amount, 0),
        COALESCE(pr.book_amount, pr.amount, 0)
    ) > 0
  AND NOT EXISTS (
    SELECT 1 FROM book_commissions bc
    WHERE bc.payment_request_id = pr.id AND bc.course_book_id = bco.course_book_id
  );

-- book_addon payments from book_items JSON
INSERT INTO book_commissions (
    course_book_id, course_id, teacher_id, student_id,
    payment_request_id, entitlement_id,
    book_amount, platform_percent, platform_amount, teacher_amount, currency, created_at
)
SELECT
    (item->>'bookId')::uuid,
    pr.course_id,
    cb.teacher_id,
    pr.user_id,
    pr.id,
    be.id,
    COALESCE((item->>'addonPrice')::numeric, (item->>'price')::numeric, pr.book_amount, 0),
    COALESCE(cup.custom_book_percent, ass.book_platform_percent, 0),
    ROUND(
        COALESCE((item->>'addonPrice')::numeric, (item->>'price')::numeric, pr.book_amount, 0)
        * COALESCE(cup.custom_book_percent, ass.book_platform_percent, 0) / 100,
        2
    ),
    ROUND(
        COALESCE((item->>'addonPrice')::numeric, (item->>'price')::numeric, pr.book_amount, 0)
        * (100 - COALESCE(cup.custom_book_percent, ass.book_platform_percent, 0)) / 100,
        2
    ),
    COALESCE(pr.currency, 'BDT'),
    COALESCE(pr.reviewed_at, pr.created_at, NOW())
FROM course_payment_requests pr
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(pr.book_items) = 'array' THEN pr.book_items
        ELSE '[]'::jsonb
    END
) AS item
JOIN course_books cb ON cb.id = (item->>'bookId')::uuid
LEFT JOIN book_entitlements be
    ON be.user_id = pr.user_id AND be.course_book_id = cb.id AND be.revoked_at IS NULL
LEFT JOIN custom_user_percentages cup
    ON cup.user_type = 'teacher' AND cup.user_id = cb.teacher_id
CROSS JOIN admin_share_settings ass
WHERE ass.id = '00000000-0000-0000-0000-000000000001'::uuid
  AND pr.status = 'accepted'
  AND pr.purchase_type IN ('book_addon', 'course_with_books')
  AND (item->>'bookId') IS NOT NULL
  AND COALESCE((item->>'addonPrice')::numeric, (item->>'price')::numeric, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM book_commissions bc
    WHERE bc.payment_request_id = pr.id
      AND bc.course_book_id = (item->>'bookId')::uuid
  );
