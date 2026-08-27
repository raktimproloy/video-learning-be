const db = require('../../db');

class BookEntitlementService {
    async getActive(userId, courseBookId) {
        const result = await db.query(
            `SELECT * FROM book_entitlements
             WHERE user_id = $1 AND course_book_id = $2 AND revoked_at IS NULL`,
            [userId, courseBookId]
        );
        if (result.rows[0]) return result.rows[0];

        // Check if user is the teacher/author of the course book
        const bookRes = await db.query(
            `SELECT cb.id, cb.course_id, cb.teacher_id, cb.delivery_mode, cb.pricing_mode, cb.status
             FROM course_books cb WHERE cb.id = $1`,
            [courseBookId]
        );
        const book = bookRes.rows[0];
        if (!book) return null;

        if (String(book.teacher_id) === String(userId)) {
            return {
                id: `teacher-${book.id}`,
                user_id: userId,
                course_id: book.course_id,
                course_book_id: book.id,
                source: 'teacher',
                has_pdf: true,
                has_courier: false,
                purchase_blocked: false,
            };
        }

        // Check if book is free/included and student is actively enrolled
        if (book.status === 'published' && (book.pricing_mode === 'free_with_course' || book.pricing_mode === 'included')) {
            const courseService = require('./courseService');
            const enrolled = await courseService.isEnrolled(userId, book.course_id);
            if (enrolled) {
                return {
                    id: `enrolled-${book.id}`,
                    user_id: userId,
                    course_id: book.course_id,
                    course_book_id: book.id,
                    source: 'course_enrollment',
                    has_pdf: book.delivery_mode === 'pdf_only' || book.delivery_mode === 'both',
                    has_courier: false,
                    purchase_blocked: true,
                };
            }
        }

        return null;
    }

    async isPurchaseBlocked(userId, courseBookId) {
        const bookRes = await db.query(
            `SELECT delivery_mode FROM course_books WHERE id = $1`,
            [courseBookId]
        );
        const delivery = bookRes.rows[0]?.delivery_mode;
        if (delivery === 'courier_only' || delivery === 'both') {
            const bookCourierService = require('./bookCourierService');
            try {
                const elig = await bookCourierService.getEligibility(courseBookId, userId);
                return !elig.canOrder;
            } catch {
                return false;
            }
        }
        const ent = await this.getActive(userId, courseBookId);
        return !!(ent && ent.purchase_blocked);
    }

    async listForUser(userId) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS book_reading_progress (
                user_id UUID NOT NULL,
                course_book_id UUID NOT NULL REFERENCES course_books(id) ON DELETE CASCADE,
                last_page INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, course_book_id)
            )
        `);

        // 1. Explicit entitlements (latest non-terminal courier order when present)
        const result = await db.query(
            `SELECT be.id, be.course_book_id AS book_id, be.course_id, be.source,
                    be.has_pdf, be.has_courier, be.purchase_blocked, be.created_at,
                    cb.title, cb.subtitle, cb.cover_path, cb.delivery_mode,
                    cb.total_pages, cb.processing_status, cb.status AS book_status,
                    cb.max_courier_orders_per_student, cb.addon_price, cb.pricing_mode,
                    c.title AS course_title,
                    bco.id AS courier_order_id, bco.status AS courier_status,
                    bco.tracking_number, bco.payment_status AS courier_payment_status,
                    bco.quantity AS courier_quantity, bco.created_at AS courier_ordered_at,
                    COALESCE(brp.last_page, 0) AS last_page,
                    (SELECT COUNT(*) FROM book_user_annotations ba WHERE ba.course_book_id = be.course_book_id AND ba.user_id = be.user_id) AS annotation_count
             FROM book_entitlements be
             JOIN course_books cb ON cb.id = be.course_book_id
             JOIN courses c ON c.id = be.course_id
             LEFT JOIN LATERAL (
                SELECT *
                FROM book_courier_orders o
                WHERE o.entitlement_id = be.id
                ORDER BY
                    CASE WHEN o.status NOT IN ('delivered', 'cancelled') THEN 0 ELSE 1 END,
                    o.created_at DESC
                LIMIT 1
             ) bco ON true
             LEFT JOIN book_reading_progress brp ON brp.course_book_id = be.course_book_id AND brp.user_id = be.user_id
             WHERE be.user_id = $1 AND be.revoked_at IS NULL
             ORDER BY be.created_at DESC`,
            [userId]
        );

        const existingBookIds = new Set(result.rows.map((r) => r.book_id));
        const combinedRows = [...result.rows];

        // 2. Free / included books for courses the user is actively enrolled in
        const freeEnrolledRes = await db.query(
            `SELECT cb.id AS book_id, cb.course_id, 'course_enrollment' AS source,
                    (cb.delivery_mode IN ('pdf_only', 'both')) AS has_pdf,
                    false AS has_courier,
                    true AS purchase_blocked,
                    ce.enrolled_at AS created_at,
                    cb.title, cb.subtitle, cb.cover_path, cb.delivery_mode,
                    cb.total_pages, cb.processing_status, cb.status AS book_status,
                    c.title AS course_title,
                    NULL AS courier_order_id, NULL AS courier_status,
                    NULL AS tracking_number,
                    COALESCE(brp.last_page, 0) AS last_page,
                    (SELECT COUNT(*) FROM book_user_annotations ba WHERE ba.course_book_id = cb.id AND ba.user_id = $1) AS annotation_count
             FROM course_enrollments ce
             JOIN course_books cb ON cb.course_id = ce.course_id AND cb.status = 'published' AND cb.pricing_mode IN ('free_with_course', 'included')
             JOIN courses c ON c.id = ce.course_id
             LEFT JOIN book_reading_progress brp ON brp.course_book_id = cb.id AND brp.user_id = $1
             WHERE ce.user_id = $1 AND ce.is_active = true`,
            [userId]
        );

        for (const row of freeEnrolledRes.rows) {
            if (!existingBookIds.has(row.book_id)) {
                existingBookIds.add(row.book_id);
                row.id = `enrolled-${row.book_id}`;
                combinedRows.push(row);
            }
        }

        // 3. Books authored by the user as teacher
        const teacherBooksRes = await db.query(
            `SELECT cb.id AS book_id, cb.course_id, 'teacher' AS source,
                    true AS has_pdf,
                    false AS has_courier,
                    false AS purchase_blocked,
                    cb.created_at,
                    cb.title, cb.subtitle, cb.cover_path, cb.delivery_mode,
                    cb.total_pages, cb.processing_status, cb.status AS book_status,
                    c.title AS course_title,
                    NULL AS courier_order_id, NULL AS courier_status,
                    NULL AS tracking_number,
                    COALESCE(brp.last_page, 0) AS last_page,
                    (SELECT COUNT(*) FROM book_user_annotations ba WHERE ba.course_book_id = cb.id AND ba.user_id = $1) AS annotation_count
             FROM course_books cb
             JOIN courses c ON c.id = cb.course_id
             LEFT JOIN book_reading_progress brp ON brp.course_book_id = cb.id AND brp.user_id = $1
             WHERE cb.teacher_id = $1 AND cb.status != 'archived'
             ORDER BY cb.created_at DESC`,
            [userId]
        );

        for (const row of teacherBooksRes.rows) {
            if (!existingBookIds.has(row.book_id)) {
                existingBookIds.add(row.book_id);
                row.id = `teacher-${row.book_id}`;
                combinedRows.push(row);
            }
        }

        return combinedRows.map((r) => {
            const total = r.total_pages || 0;
            const progressPercent = total > 0 && r.last_page ? Math.min(100, Math.round((r.last_page / total) * 100)) : 0;
            const activeCourier =
                r.courier_status && !['delivered', 'cancelled'].includes(r.courier_status)
                    ? {
                          id: r.courier_order_id,
                          status: r.courier_status,
                          paymentStatus: r.courier_payment_status || null,
                          quantity: r.courier_quantity != null ? parseInt(r.courier_quantity, 10) : 1,
                          orderedAt: r.courier_ordered_at || null,
                          trackingNumber: r.tracking_number || null,
                      }
                    : null;
            return {
                id: r.id,
                bookId: r.book_id,
                courseId: r.course_id,
                source: r.source,
                hasPdf: r.has_pdf,
                hasCourier: r.has_courier,
                purchaseBlocked: r.purchase_blocked,
                createdAt: r.created_at,
                title: r.title,
                subtitle: r.subtitle,
                coverPath: r.cover_path,
                deliveryMode: r.delivery_mode,
                pricingMode: r.pricing_mode || null,
                addonPrice: r.addon_price != null ? parseFloat(r.addon_price) : null,
                maxCourierOrdersPerStudent:
                    r.max_courier_orders_per_student != null
                        ? parseInt(r.max_courier_orders_per_student, 10)
                        : null,
                totalPages: r.total_pages,
                processingStatus: r.processing_status,
                bookStatus: r.book_status,
                courseTitle: r.course_title,
                courierOrderId: activeCourier ? activeCourier.id : r.courier_order_id,
                courierStatus: activeCourier ? activeCourier.status : null,
                courierPaymentStatus: activeCourier ? activeCourier.paymentStatus : null,
                courierQuantity: activeCourier ? activeCourier.quantity : null,
                courierOrderedAt: activeCourier ? activeCourier.orderedAt : null,
                trackingNumber: activeCourier ? activeCourier.trackingNumber : r.tracking_number,
                lastPage: r.last_page,
                annotationCount: parseInt(r.annotation_count || '0', 10),
                progressPercent: progressPercent,
            };
        });
    }

    /**
     * Enrich book list with order quota fields (remaining / canOrder).
     */
    async listForUserWithEligibility(userId) {
        const books = await this.listForUser(userId);
        const bookCourierService = require('./bookCourierService');
        const enriched = [];
        for (const b of books) {
            if (b.deliveryMode === 'courier_only' || b.deliveryMode === 'both' || b.hasCourier) {
                try {
                    const elig = await bookCourierService.getEligibility(b.bookId, userId);
                    enriched.push({
                        ...b,
                        remainingOrders: elig.remaining,
                        canOrder: elig.canOrder,
                        alreadyPurchased: elig.alreadyPurchased,
                        hasActiveOrder: elig.hasActiveOrder,
                        maxCourierOrdersPerStudent: elig.maxCourierOrdersPerStudent,
                        pdfOwned: elig.pdfOwned,
                        canBuyPdf: elig.canBuyPdf,
                        unitBookPrice: elig.unitBookPrice,
                        courierFees: elig.courierFees,
                        courierFeePaidBy: elig.courierFeePaidBy,
                        isOwned: true,
                    });
                    continue;
                } catch {
                    /* fall through */
                }
            }
            enriched.push({
                ...b,
                isOwned: true,
                remainingOrders: null,
                canOrder: false,
                alreadyPurchased: !!b.purchaseBlocked,
                hasActiveOrder: !!(
                    b.courierStatus && !['delivered', 'cancelled'].includes(b.courierStatus)
                ),
            });
        }
        return enriched;
    }

    /**
     * Grant entitlement. Idempotent via UNIQUE(user_id, course_book_id).
     */
    async grant({
        userId,
        courseId,
        courseBookId,
        source = 'purchase',
        hasPdf = true,
        hasCourier = false,
        paymentRequestId = null,
        priceSnapshot = {},
        skipCourierOrder = false,
        skipStockDecrement = false,
        forcePurchaseBlocked = null,
    }) {
        const book = await db.query(`SELECT * FROM course_books WHERE id = $1`, [courseBookId]);
        if (!book.rows[0]) {
            const err = new Error('Book not found');
            err.status = 404;
            throw err;
        }
        const b = book.rows[0];
        const delivery = b.delivery_mode;
        const pdf = hasPdf && (delivery === 'pdf_only' || delivery === 'both');
        // PDF and hardcopy are separate: do not auto-flag courier for delivery_mode=both.
        const courier = !!hasCourier || delivery === 'courier_only';

        // Stock check for courier (legacy single-copy grant path)
        if (courier && !skipStockDecrement && b.stock_limit != null) {
            const stockRes = await db.query(
                `UPDATE course_books
                 SET stock_remaining = GREATEST(0, COALESCE(stock_remaining, stock_limit) - 1),
                     updated_at = NOW()
                 WHERE id = $1 AND (stock_remaining IS NULL OR stock_remaining > 0)
                 RETURNING stock_remaining`,
                [courseBookId]
            );
            if (!stockRes.rows[0] && b.stock_remaining === 0) {
                const err = new Error('Book is out of stock for courier delivery');
                err.status = 409;
                throw err;
            }
        }

        // PDF-only: block repurchase. Courier books: block only when quota exhausted (synced later).
        let purchaseBlocked = forcePurchaseBlocked;
        if (purchaseBlocked == null) {
            if (delivery === 'pdf_only') {
                purchaseBlocked = true;
            } else {
                purchaseBlocked = false;
            }
        }

        const result = await db.query(
            `INSERT INTO book_entitlements (
                user_id, course_id, course_book_id, source, has_pdf, has_courier,
                purchase_blocked, payment_request_id, price_snapshot
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (user_id, course_book_id) DO UPDATE SET
                revoked_at = NULL,
                purchase_blocked = CASE
                    WHEN $7::boolean = true THEN true
                    ELSE book_entitlements.purchase_blocked
                END,
                has_pdf = EXCLUDED.has_pdf OR book_entitlements.has_pdf,
                has_courier = EXCLUDED.has_courier OR book_entitlements.has_courier,
                source = CASE
                    WHEN book_entitlements.source = 'gift' THEN book_entitlements.source
                    ELSE EXCLUDED.source
                END,
                payment_request_id = COALESCE(EXCLUDED.payment_request_id, book_entitlements.payment_request_id),
                price_snapshot = COALESCE(EXCLUDED.price_snapshot, book_entitlements.price_snapshot),
                updated_at = NOW()
             RETURNING *`,
            [
                userId,
                courseId || b.course_id,
                courseBookId,
                source,
                pdf,
                courier && (delivery === 'courier_only' || delivery === 'both'),
                purchaseBlocked,
                paymentRequestId,
                JSON.stringify(priceSnapshot || {}),
            ]
        );

        const entitlement = result.rows[0];

        // Legacy path: create a pending_address order only when none exists yet
        if (entitlement.has_courier && !skipCourierOrder) {
            const existingActive = await db.query(
                `SELECT id FROM book_courier_orders
                 WHERE entitlement_id = $1 AND status NOT IN ('delivered', 'cancelled')
                 LIMIT 1`,
                [entitlement.id]
            );
            const anyOrder = await db.query(
                `SELECT id FROM book_courier_orders WHERE entitlement_id = $1 LIMIT 1`,
                [entitlement.id]
            );
            if (!existingActive.rows[0] && !anyOrder.rows[0]) {
                await db.query(
                    `INSERT INTO book_courier_orders (
                        entitlement_id, teacher_id, student_id, course_book_id, status, quantity
                     ) VALUES ($1, $2, $3, $4, 'pending_address', 1)`,
                    [entitlement.id, b.teacher_id, userId, courseBookId]
                );
            }
        }

        return entitlement;
    }

    async grantFromPayment(paymentRequest) {
        const items = paymentRequest.book_items;
        let bookItems = [];
        if (typeof items === 'string') {
            try {
                bookItems = JSON.parse(items);
            } catch {
                bookItems = [];
            }
        } else if (Array.isArray(items)) {
            bookItems = items;
        }

        const bookCommissionService = require('./bookCommissionService');
        const granted = [];

        for (const item of bookItems) {
            const bookId = item.bookId || item.id;
            if (!bookId) continue;

            const existing = await this.getActive(paymentRequest.user_id, bookId);
            if (existing && existing.purchase_blocked) {
                // Already entitled with no remaining quota — skip but don't fail
                continue;
            }

            const isBookCourier = paymentRequest.purchase_type === 'book_courier';
            const isCourierFee = paymentRequest.purchase_type === 'courier_fee';
            try {
                const entitlement = await this.grant({
                    userId: paymentRequest.user_id,
                    courseId: paymentRequest.course_id,
                    courseBookId: bookId,
                    source: 'purchase',
                    paymentRequestId: paymentRequest.id,
                    hasPdf: !isCourierFee,
                    hasCourier: isBookCourier || isCourierFee,
                    skipCourierOrder: isBookCourier || isCourierFee || paymentRequest.purchase_type === 'book_addon',
                    skipStockDecrement: isBookCourier || isCourierFee,
                    priceSnapshot: {
                        addonPrice: item.addonPrice ?? item.price ?? 0,
                        courierFee: item.courierFee ?? 0,
                        quantity: item.quantity || 1,
                        title: item.title || null,
                    },
                });

                try {
                    await bookCommissionService.recordFromPurchase({
                        courseBookId: bookId,
                        courseId: paymentRequest.course_id,
                        studentId: paymentRequest.user_id,
                        paymentRequestId: paymentRequest.id,
                        entitlementId: entitlement.id,
                        bookAmount: bookCommissionService.resolveBookAmount(item, paymentRequest),
                        currency: paymentRequest.currency || 'BDT',
                    });
                } catch (commErr) {
                    console.error('Book commission record failed (entitlement kept):', commErr.message);
                }

                granted.push(entitlement);
            } catch (grantErr) {
                console.error(`Book grant failed for ${bookId}:`, grantErr.message);
                // Continue granting other books
            }
        }

        // Included / free-with-course books on any course enrollment payment
        if (
            paymentRequest.purchase_type === 'course_with_books' ||
            paymentRequest.purchase_type === 'course_only'
        ) {
            const freeBooks = await db.query(
                `SELECT id FROM course_books
                 WHERE course_id = $1 AND status = 'published'
                   AND pricing_mode IN ('free_with_course', 'included')`,
                [paymentRequest.course_id]
            );
            for (const fb of freeBooks.rows) {
                const already = await this.getActive(paymentRequest.user_id, fb.id);
                if (already) continue;
                try {
                    const ent = await this.grant({
                        userId: paymentRequest.user_id,
                        courseId: paymentRequest.course_id,
                        courseBookId: fb.id,
                        source: 'purchase',
                        paymentRequestId: paymentRequest.id,
                        priceSnapshot: { addonPrice: 0, free: true },
                    });
                    granted.push(ent);
                } catch (grantErr) {
                    console.error(`Included book grant failed for ${fb.id}:`, grantErr.message);
                }
            }
        }

        return granted;
    }

    async gift({ teacherId, courseId, bookId, studentUserId }) {
        const book = await db.query(
            `SELECT * FROM course_books WHERE id = $1 AND course_id = $2`,
            [bookId, courseId]
        );
        if (!book.rows[0]) {
            const err = new Error('Book not found on this course');
            err.status = 404;
            throw err;
        }
        if (String(book.rows[0].teacher_id) !== String(teacherId)) {
            const err = new Error('Not authorized');
            err.status = 403;
            throw err;
        }

        const courseService = require('./courseService');
        const enrolled = await courseService.isEnrolled(studentUserId, courseId);
        if (!enrolled) {
            const err = new Error('Student must be enrolled in the course');
            err.status = 400;
            throw err;
        }

        return this.grant({
            userId: studentUserId,
            courseId,
            courseBookId: bookId,
            source: 'gift',
            priceSnapshot: { gifted: true },
        });
    }

    async revoke(entitlementId, teacherId) {
        const result = await db.query(
            `SELECT be.*, cb.teacher_id
             FROM book_entitlements be
             JOIN course_books cb ON cb.id = be.course_book_id
             WHERE be.id = $1`,
            [entitlementId]
        );
        const row = result.rows[0];
        if (!row) {
            const err = new Error('Entitlement not found');
            err.status = 404;
            throw err;
        }
        if (String(row.teacher_id) !== String(teacherId)) {
            const err = new Error('Not authorized');
            err.status = 403;
            throw err;
        }
        await db.query(
            `UPDATE book_entitlements SET revoked_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [entitlementId]
        );
        return { revoked: true };
    }

    async listRecipientsForBook(bookId) {
        const bookRes = await db.query(`SELECT * FROM course_books WHERE id = $1`, [bookId]);
        const book = bookRes.rows[0];
        if (!book) {
            const err = new Error('Book not found');
            err.status = 404;
            throw err;
        }

        // 1. Explicit entitlements
        const entRes = await db.query(
            `SELECT be.id, be.user_id, be.course_id, be.course_book_id, be.source,
                    be.has_pdf, be.has_courier, be.purchase_blocked, be.price_snapshot,
                    be.created_at, be.updated_at,
                    u.email AS user_email, COALESCE(sp.name, u.email) AS user_name,
                    sp.phone AS user_phone,
                    bco.id AS courier_order_id, bco.status AS courier_status,
                    bco.tracking_number, bco.recipient_name, bco.recipient_phone, bco.delivery_address,
                    bco.city, bco.district, bco.courier_service
             FROM book_entitlements be
             JOIN users u ON u.id = be.user_id
             LEFT JOIN student_profiles sp ON sp.user_id = u.id
             LEFT JOIN book_courier_orders bco ON bco.entitlement_id = be.id
             WHERE be.course_book_id = $1 AND be.revoked_at IS NULL
             ORDER BY be.created_at DESC`,
            [bookId]
        );

        const recipients = entRes.rows.map((r) => ({
            id: r.id,
            userId: r.user_id,
            userName: r.user_name,
            userEmail: r.user_email,
            userPhone: r.user_phone || null,
            source: r.source || 'purchase',
            hasPdf: !!r.has_pdf,
            hasCourier: !!r.has_courier,
            priceSnapshot: r.price_snapshot,
            grantedAt: r.created_at,
            courierOrder: r.courier_order_id
                ? {
                      id: r.courier_order_id,
                      status: r.courier_status,
                      trackingNumber: r.tracking_number,
                      recipientName: r.recipient_name,
                      recipientPhone: r.recipient_phone,
                      deliveryAddress: r.delivery_address,
                      city: r.city,
                      district: r.district,
                      courierService: r.courier_service,
                  }
                : null,
        }));

        // 2. If book is free/included with course, also include active course enrollments if not already in entitlements
        if (book.status === 'published' && (book.pricing_mode === 'free_with_course' || book.pricing_mode === 'included')) {
            const existingUserIds = new Set(recipients.map((r) => r.userId));
            const enrolledRes = await db.query(
                `SELECT ce.user_id, ce.enrolled_at,
                        u.email AS user_email, COALESCE(sp.name, u.email) AS user_name,
                        sp.phone AS user_phone
                 FROM course_enrollments ce
                 JOIN users u ON u.id = ce.user_id
                 LEFT JOIN student_profiles sp ON sp.user_id = u.id
                 WHERE ce.course_id = $1 AND ce.is_active = true
                 ORDER BY ce.enrolled_at DESC`,
                [book.course_id]
            );

            for (const row of enrolledRes.rows) {
                if (!existingUserIds.has(row.user_id)) {
                    existingUserIds.add(row.user_id);
                    recipients.push({
                        id: `enrolled-${row.user_id}`,
                        userId: row.user_id,
                        userName: row.user_name,
                        userEmail: row.user_email,
                        userPhone: row.user_phone || null,
                        source: 'course_enrollment',
                        hasPdf: book.delivery_mode === 'pdf_only' || book.delivery_mode === 'both',
                        hasCourier: false,
                        priceSnapshot: { free_included: true },
                        grantedAt: row.enrolled_at,
                        courierOrder: null,
                    });
                }
            }
        }

        return {
            bookId,
            bookTitle: book.title,
            totalRecipients: recipients.length,
            recipients,
        };
    }

    async adminManualGrant({ bookId, emailOrUserId, hasPdf = true, hasCourier = false, note = null }) {
        const bookRes = await db.query(`SELECT * FROM course_books WHERE id = $1`, [bookId]);
        const book = bookRes.rows[0];
        if (!book) {
            const err = new Error('Book not found');
            err.status = 404;
            throw err;
        }

        const trimmed = String(emailOrUserId || '').trim();
        const userRes = await db.query(
            `SELECT id, email FROM users WHERE LOWER(email) = LOWER($1) OR id::text = $1 LIMIT 1`,
            [trimmed]
        );
        const user = userRes.rows[0];
        if (!user) {
            const err = new Error(`Student user not found for "${trimmed}". Please enter a valid registered email or User ID.`);
            err.status = 404;
            throw err;
        }

        const entitlement = await this.grant({
            userId: user.id,
            courseId: book.course_id,
            courseBookId: bookId,
            source: 'manual',
            hasPdf: Boolean(hasPdf),
            hasCourier: Boolean(hasCourier),
            priceSnapshot: {
                manualGrant: true,
                note: note || null,
                grantedAt: new Date().toISOString(),
                grantedBy: 'admin',
            },
        });

        return entitlement;
    }

    async adminRevokeGrant({ entitlementId }) {
        const result = await db.query(
            `UPDATE book_entitlements
             SET revoked_at = NOW(), updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [entitlementId]
        );
        if (!result.rows[0]) {
            const err = new Error('Entitlement not found');
            err.status = 404;
            throw err;
        }
        return { revoked: true, entitlementId };
    }
}

module.exports = new BookEntitlementService();
