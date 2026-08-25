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

        // 1. Explicit entitlements
        const result = await db.query(
            `SELECT be.id, be.course_book_id AS book_id, be.course_id, be.source,
                    be.has_pdf, be.has_courier, be.purchase_blocked, be.created_at,
                    cb.title, cb.subtitle, cb.cover_path, cb.delivery_mode,
                    cb.total_pages, cb.processing_status, cb.status AS book_status,
                    c.title AS course_title,
                    bco.id AS courier_order_id, bco.status AS courier_status,
                    bco.tracking_number,
                    COALESCE(brp.last_page, 0) AS last_page,
                    (SELECT COUNT(*) FROM book_user_annotations ba WHERE ba.course_book_id = be.course_book_id AND ba.user_id = be.user_id) AS annotation_count
             FROM book_entitlements be
             JOIN course_books cb ON cb.id = be.course_book_id
             JOIN courses c ON c.id = be.course_id
             LEFT JOIN book_courier_orders bco ON bco.entitlement_id = be.id
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
                totalPages: r.total_pages,
                processingStatus: r.processing_status,
                bookStatus: r.book_status,
                courseTitle: r.course_title,
                courierOrderId: r.courier_order_id,
                courierStatus: r.courier_status,
                trackingNumber: r.tracking_number,
                lastPage: r.last_page,
                annotationCount: parseInt(r.annotation_count || '0', 10),
                progressPercent: progressPercent
            };
        });
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
        const courier = hasCourier || delivery === 'courier_only' || delivery === 'both';

        // Stock check for courier
        if (courier && b.stock_limit != null) {
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

        const result = await db.query(
            `INSERT INTO book_entitlements (
                user_id, course_id, course_book_id, source, has_pdf, has_courier,
                purchase_blocked, payment_request_id, price_snapshot
             ) VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8)
             ON CONFLICT (user_id, course_book_id) DO UPDATE SET
                revoked_at = NULL,
                purchase_blocked = true,
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
                paymentRequestId,
                JSON.stringify(priceSnapshot || {}),
            ]
        );

        const entitlement = result.rows[0];

        if (entitlement.has_courier) {
            const existingOrder = await db.query(
                `SELECT id FROM book_courier_orders WHERE entitlement_id = $1`,
                [entitlement.id]
            );
            if (!existingOrder.rows[0]) {
                await db.query(
                    `INSERT INTO book_courier_orders (
                        entitlement_id, teacher_id, student_id, course_book_id, status
                     ) VALUES ($1, $2, $3, $4, 'pending_address')`,
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
                // Already entitled (e.g. gift) — skip but don't fail the whole payment
                continue;
            }

            try {
                const entitlement = await this.grant({
                    userId: paymentRequest.user_id,
                    courseId: paymentRequest.course_id,
                    courseBookId: bookId,
                    source: 'purchase',
                    paymentRequestId: paymentRequest.id,
                    priceSnapshot: {
                        addonPrice: item.addonPrice ?? item.price ?? 0,
                        courierFee: item.courierFee ?? 0,
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
                        bookAmount: parseFloat(item.addonPrice ?? item.price ?? 0) || 0,
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
}

module.exports = new BookEntitlementService();
