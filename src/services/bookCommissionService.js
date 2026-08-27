const db = require('../../db');

function parseBookItems(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

function resolvePurchaseType(row) {
    if (!row) return 'course_only';
    let type = row.purchase_type || row.purchaseType || 'course_only';
    if (type === 'books_only') type = 'book_addon';
    const items = parseBookItems(row.book_items);
    const bookAmt = row.book_amount != null ? parseFloat(row.book_amount) : 0;
    const courseAmt = row.course_amount != null ? parseFloat(row.course_amount) : null;
    if (
        type === 'course_only' &&
        items.length > 0 &&
        bookAmt > 0 &&
        (courseAmt == null || courseAmt === 0)
    ) {
        return 'book_addon';
    }
    return type;
}

class BookCommissionService {
    async getPlatformPercent(teacherId) {
        if (teacherId) {
            const custom = await db.query(
                `SELECT custom_book_percent FROM custom_user_percentages
                 WHERE user_type = 'teacher' AND user_id = $1`,
                [teacherId]
            );
            if (
                custom.rows[0] &&
                custom.rows[0].custom_book_percent != null &&
                !Number.isNaN(parseFloat(custom.rows[0].custom_book_percent))
            ) {
                return parseFloat(custom.rows[0].custom_book_percent);
            }
        }

        const settings = await db.query(
            `SELECT book_platform_percent FROM admin_share_settings
             WHERE id = '00000000-0000-0000-0000-000000000001'::uuid`
        );
        const pct = settings.rows[0]?.book_platform_percent;
        return pct != null ? parseFloat(pct) : 0;
    }

    resolveBookAmount(item, paymentRequest) {
        const purchaseType = resolvePurchaseType(paymentRequest);
        const addon = parseFloat(item?.addonPrice ?? item?.price ?? 0) || 0;
        const courier = parseFloat(item?.courierFee ?? 0) || 0;

        if (purchaseType === 'book_courier') {
            if (addon + courier > 0) return Math.round((addon + courier) * 100) / 100;
            const prBook = parseFloat(paymentRequest.book_amount ?? paymentRequest.amount ?? 0) || 0;
            return prBook;
        }
        if (purchaseType === 'courier_fee') {
            if (courier > 0) return courier;
            return parseFloat(paymentRequest.book_amount ?? paymentRequest.amount ?? 0) || 0;
        }
        if (addon > 0) return addon;
        return parseFloat(paymentRequest.book_amount ?? 0) || 0;
    }

    async recordFromPurchase({
        courseBookId,
        courseId,
        studentId,
        paymentRequestId,
        entitlementId,
        bookAmount,
        currency = 'BDT',
    }) {
        const amount = parseFloat(bookAmount) || 0;
        if (amount <= 0) return null;

        if (paymentRequestId) {
            const existing = await db.query(
                `SELECT id FROM book_commissions
                 WHERE payment_request_id = $1 AND course_book_id = $2
                 LIMIT 1`,
                [paymentRequestId, courseBookId]
            );
            if (existing.rows[0]) return existing.rows[0];
        }

        const book = await db.query(
            `SELECT teacher_id, course_id FROM course_books WHERE id = $1`,
            [courseBookId]
        );
        const teacherId = book.rows[0]?.teacher_id;
        const resolvedCourseId = courseId || book.rows[0]?.course_id;
        if (!teacherId) return null;

        const platformPercent = await this.getPlatformPercent(teacherId);
        const platformAmount = Math.round(((amount * platformPercent) / 100) * 100) / 100;
        const teacherAmount = Math.round((amount - platformAmount) * 100) / 100;

        const result = await db.query(
            `INSERT INTO book_commissions (
                course_book_id, course_id, teacher_id, student_id,
                payment_request_id, entitlement_id,
                book_amount, platform_percent, platform_amount, teacher_amount, currency
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [
                courseBookId,
                resolvedCourseId,
                teacherId,
                studentId,
                paymentRequestId,
                entitlementId,
                amount,
                platformPercent,
                platformAmount,
                teacherAmount,
                currency,
            ]
        );
        return result.rows[0];
    }

    /** Record all book line items from an accepted payment (idempotent). */
    async recordFromPaymentRequest(paymentRequest) {
        const purchaseType = resolvePurchaseType(paymentRequest);
        const bookTypes = new Set(['book_addon', 'book_courier', 'courier_fee', 'course_with_books']);
        if (!bookTypes.has(purchaseType)) return [];

        let bookItems = parseBookItems(paymentRequest.book_items);

        if (bookItems.length === 0 && (purchaseType === 'book_courier' || purchaseType === 'courier_fee')) {
            const orderRes = await db.query(
                `SELECT course_book_id, book_price_amount, courier_fee_amount, quantity, entitlement_id
                 FROM book_courier_orders
                 WHERE payment_request_id = $1
                 LIMIT 1`,
                [paymentRequest.id]
            );
            if (orderRes.rows[0]) {
                const o = orderRes.rows[0];
                bookItems = [
                    {
                        bookId: o.course_book_id,
                        addonPrice: o.book_price_amount,
                        courierFee: o.courier_fee_amount,
                        quantity: o.quantity,
                        entitlementId: o.entitlement_id,
                    },
                ];
            }
        }

        const recorded = [];
        for (const item of bookItems) {
            const bookId = item.bookId || item.id;
            if (!bookId) continue;

            const amount = this.resolveBookAmount(item, paymentRequest);
            if (amount <= 0) continue;

            try {
                const row = await this.recordFromPurchase({
                    courseBookId: bookId,
                    courseId: paymentRequest.course_id,
                    studentId: paymentRequest.user_id,
                    paymentRequestId: paymentRequest.id,
                    entitlementId: item.entitlementId || null,
                    bookAmount: amount,
                    currency: paymentRequest.currency || 'BDT',
                });
                if (row) recorded.push(row);
            } catch (err) {
                console.error('Book commission item record failed:', err.message);
            }
        }

        return recorded;
    }

    async getTeacherRevenueStats(teacherId, startOfMonth) {
        const monthIso = startOfMonth.toISOString();
        const result = await db.query(
            `SELECT
                COALESCE(SUM(book_amount), 0)::float AS total_gross,
                COALESCE(SUM(platform_amount), 0)::float AS total_platform,
                COALESCE(SUM(teacher_amount), 0)::float AS total_teacher,
                COUNT(*)::int AS sale_count,
                COALESCE(SUM(book_amount) FILTER (WHERE created_at >= $2::timestamptz), 0)::float AS gross_this_month,
                COALESCE(SUM(platform_amount) FILTER (WHERE created_at >= $2::timestamptz), 0)::float AS platform_this_month,
                COALESCE(COUNT(*) FILTER (WHERE created_at >= $2::timestamptz), 0)::int AS sale_count_this_month
             FROM book_commissions
             WHERE teacher_id = $1`,
            [teacherId, monthIso]
        );
        return result.rows[0] || {
            total_gross: 0,
            total_platform: 0,
            total_teacher: 0,
            sale_count: 0,
            gross_this_month: 0,
            platform_this_month: 0,
            sale_count_this_month: 0,
        };
    }

    async getTeacherEarnings(teacherId) {
        const result = await db.query(
            `SELECT
                COALESCE(SUM(teacher_amount), 0)::float AS total_teacher,
                COALESCE(SUM(platform_amount), 0)::float AS total_platform,
                COALESCE(SUM(book_amount), 0)::float AS total_gross,
                COUNT(*)::int AS sale_count
             FROM book_commissions
             WHERE teacher_id = $1`,
            [teacherId]
        );
        return result.rows[0];
    }
}

module.exports = new BookCommissionService();
