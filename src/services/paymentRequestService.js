const db = require('../../db');
const smsService = require('../utils/smsService');
const ADMIN_NEW_PAYMENT_ALERT_PHONE =
    process.env.ADMIN_NEW_PAYMENT_ALERT_PHONE || '01303644935';

const BOOK_ONLY_PURCHASE_TYPES = new Set(['book_addon', 'book_courier', 'courier_fee']);

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

function isBookOnlyPurchaseType(purchaseType) {
    return BOOK_ONLY_PURCHASE_TYPES.has(purchaseType);
}

/**
 * Normalize legacy/wrong purchase_type values (e.g. books_only stored as course_only).
 */
function resolvePurchaseType(row) {
    if (!row) return 'course_only';
    let type = row.purchase_type || 'course_only';
    if (type === 'books_only') type = 'book_addon';

    const bookItems = parseBookItems(row.book_items);
    const bookAmt = row.book_amount != null ? parseFloat(row.book_amount) : 0;
    const courseAmt = row.course_amount != null ? parseFloat(row.course_amount) : null;

    if (
        type === 'course_only' &&
        bookItems.length > 0 &&
        bookAmt > 0 &&
        (courseAmt == null || courseAmt === 0)
    ) {
        return 'book_addon';
    }

    return type;
}

function bookTitleFromItems(bookItems) {
    const items = parseBookItems(bookItems);
    return items[0]?.title || 'Book order';
}

/**
 * Create a payment request (student checkout). Does not enroll; enrollment happens on admin accept.
 * Sends an SMS to sender_phone if provided: "Your order is on pending. Please wait some time."
 */
async function createPaymentRequest(data) {
    const {
        courseId,
        userId,
        paymentMethod,
        senderPhone,
        transactionId,
        amount,
        currency,
        couponCode,
        inviteCode,
        purchaseType = 'course_only',
        bookItems = [],
        courseAmount = null,
        bookAmount = null,
    } = data;

    let normalizedPurchaseType = purchaseType;
    if (purchaseType === 'books_only') normalizedPurchaseType = 'book_addon';

    const safePurchaseType = ['course_only', 'course_with_books', 'book_addon', 'courier_fee', 'book_courier'].includes(
        normalizedPurchaseType
    )
        ? normalizedPurchaseType
        : 'course_only';
    const safeBookItems = Array.isArray(bookItems) ? bookItems : [];

    const result = await db.query(
        `INSERT INTO course_payment_requests (
            course_id, user_id, payment_method, sender_phone, transaction_id,
            amount, currency, coupon_code, invite_code,
            purchase_type, book_items, course_amount, book_amount
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`,
        [
            courseId,
            userId,
            paymentMethod,
            senderPhone || '',
            transactionId || '',
            amount,
            currency || 'BDT',
            couponCode || null,
            inviteCode || null,
            safePurchaseType,
            JSON.stringify(safeBookItems),
            courseAmount != null ? parseFloat(courseAmount) : null,
            bookAmount != null ? parseFloat(bookAmount) : null,
        ]
    );

    // Notify student by SMS (fire-and-forget; do not fail the request if SMS fails)
    const phone = senderPhone && String(senderPhone).trim() ? String(senderPhone).trim() : null;
    if (phone) {
        smsService.sendPaymentPendingSms(phone).catch((err) => {
            console.error('Payment pending SMS failed:', err.message);
        });
    }

    // Alert admin number about newly submitted payment requests (fire-and-forget).
    const adminAlertPhone = ADMIN_NEW_PAYMENT_ALERT_PHONE && String(ADMIN_NEW_PAYMENT_ALERT_PHONE).trim()
        ? String(ADMIN_NEW_PAYMENT_ALERT_PHONE).trim()
        : null;
    if (adminAlertPhone) {
        smsService.sendNewPaymentRequestAlertSms(adminAlertPhone, {
            requestId: result.rows[0]?.id,
            courseId,
            amount,
            currency,
            method: paymentMethod,
        }).catch((err) => {
            console.error('New payment request admin SMS failed:', err.message);
        });
    }

    return result.rows[0];
}

/**
 * List payment requests for admin with optional search and status filter.
 */
async function listPaymentRequests(options = {}) {
    const { skip = 0, limit = 20, status = null, search = null } = options;

    let whereClause = '1=1';
    const params = [];
    let paramIndex = 1;

    if (status) {
        whereClause += ` AND pr.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
    }

    if (search && search.trim()) {
        const term = `%${search.trim().toLowerCase()}%`;
        whereClause += ` AND (
            LOWER(c.title) LIKE $${paramIndex}
            OR LOWER(u.email) LIKE $${paramIndex + 1}
            OR LOWER(COALESCE(sp.name, '')) LIKE $${paramIndex + 2}
            OR LOWER(pr.sender_phone) LIKE $${paramIndex + 3}
            OR LOWER(pr.transaction_id) LIKE $${paramIndex + 4}
        )`;
        params.push(term, term, term, term, term);
        paramIndex += 5;
    }

    params.push(limit, skip);

    const result = await db.query(
        `SELECT
            pr.id,
            pr.course_id,
            pr.user_id,
            pr.payment_method,
            pr.sender_phone,
            pr.transaction_id,
            pr.amount,
            pr.currency,
            pr.status,
            pr.coupon_code,
            pr.invite_code,
            pr.reviewed_at,
            pr.rejection_reason,
            pr.acceptance_reason,
            pr.purchase_type,
            pr.book_items,
            pr.course_amount,
            pr.book_amount,
            pr.created_at,
            c.title AS course_title,
            c.price AS course_price,
            c.discount_price AS course_discount_price,
            c.currency AS course_currency,
            u.email AS user_email,
            COALESCE(sp.name, u.email) AS user_name
        FROM course_payment_requests pr
        JOIN courses c ON c.id = pr.course_id
        JOIN users u ON u.id = pr.user_id
        LEFT JOIN student_profiles sp ON sp.user_id = pr.user_id
        WHERE ${whereClause}
        ORDER BY pr.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        params
    );

    const countParams = params.slice(0, params.length - 2);
    const countResult = await db.query(
        `SELECT COUNT(*)::int AS total
        FROM course_payment_requests pr
        JOIN courses c ON c.id = pr.course_id
        JOIN users u ON u.id = pr.user_id
        LEFT JOIN student_profiles sp ON sp.user_id = pr.user_id
        WHERE ${whereClause}`,
        countParams
    );

    const total = countResult.rows[0]?.total || 0;

    return {
        requests: result.rows.map((row) => {
            let parsedBookItems = [];
            if (typeof row.book_items === 'string') {
                try {
                    parsedBookItems = JSON.parse(row.book_items);
                } catch {
                    parsedBookItems = [];
                }
            } else if (Array.isArray(row.book_items)) {
                parsedBookItems = row.book_items;
            }

            return {
                id: row.id,
                courseId: row.course_id,
                userId: row.user_id,
                paymentMethod: row.payment_method,
                senderPhone: row.sender_phone,
                transactionId: row.transaction_id,
                amount: parseFloat(row.amount),
                currency: row.currency,
                status: row.status,
                couponCode: row.coupon_code,
                inviteCode: row.invite_code,
                reviewedAt: row.reviewed_at,
                rejectionReason: row.rejection_reason,
                acceptanceReason: row.acceptance_reason,
                purchaseType: row.purchase_type || 'course_only',
                bookItems: parsedBookItems,
                courseAmount: row.course_amount != null ? parseFloat(row.course_amount) : null,
                bookAmount: row.book_amount != null ? parseFloat(row.book_amount) : null,
                createdAt: row.created_at,
                courseTitle: row.course_title,
                coursePrice: row.course_price ? parseFloat(row.course_price) : null,
                courseDiscountPrice: row.course_discount_price ? parseFloat(row.course_discount_price) : null,
                courseCurrency: row.course_currency,
                userEmail: row.user_email,
                userName: row.user_name,
            };
        }),
        total,
    };
}

/**
 * Accept a payment request: enroll user in course (apply coupon if any) and update status.
 * Then creates a user notification and optionally calls the message API with sender phone.
 */
async function acceptPaymentRequest(requestId, adminUserId, accessReason = null) {
    const request = await db.query(
        `SELECT pr.*, c.title AS course_title FROM course_payment_requests pr
         JOIN courses c ON c.id = pr.course_id
         WHERE pr.id = $1`,
        [requestId]
    );
    if (!request.rows[0]) {
        return null;
    }
    const row = request.rows[0];
    const purchaseType = resolvePurchaseType(row);
    const courseTitle = row.course_title || 'Course';

    // Already accepted — still ensure book entitlements (idempotent repair)
    if (row.status === 'accepted') {
        try {
            const bookEntitlementService = require('./bookEntitlementService');
            await bookEntitlementService.grantFromPayment(row);
        } catch (bookErr) {
            console.error('Book entitlement re-grant failed:', bookErr.message);
        }
        try {
            const bookCommissionService = require('./bookCommissionService');
            await bookCommissionService.recordFromPaymentRequest(row);
        } catch (commErr) {
            console.error('Book commission re-record failed:', commErr.message);
        }
        if (purchaseType === 'courier_fee' || purchaseType === 'book_courier') {
            try {
                const bookCourierService = require('./bookCourierService');
                await bookCourierService.markPaidByPaymentRequest(requestId, {
                    decrementStock: false,
                });
            } catch (courierErr) {
                console.error('Courier mark-paid re-apply failed:', courierErr.message);
            }
        }
        return { accepted: true, alreadyAccepted: true, requestId };
    }

    if (row.status !== 'pending' && row.status !== 'rejected') {
        return null;
    }

    // Type-3 flow: if the request was previously rejected, admin must provide an access reason.
    if (row.status === 'rejected' && (!accessReason || !String(accessReason).trim())) {
        return { error: 'Access reason is required to re-approve a rejected payment request.' };
    }

    try {
        const courseService = require('./courseService');

        const alreadyEnrolled = await courseService.isEnrolled(row.user_id, row.course_id);

        // Book-only payments must never create course enrollment.
        if (!isBookOnlyPurchaseType(purchaseType) && !alreadyEnrolled) {
            if (row.coupon_code) {
                const couponApplyService = require('./couponApplyService');
                await couponApplyService.applyCoupon(row.coupon_code, row.user_id, row.course_id);
            }

            const amountPaid =
                row.amount != null && !Number.isNaN(parseFloat(row.amount))
                    ? parseFloat(row.amount)
                    : null;
            const currency = (row.currency && String(row.currency).trim()) || null;

            const enrollAmount =
                row.course_amount != null
                    ? parseFloat(row.course_amount)
                    : amountPaid;

            await courseService.enrollUser(row.user_id, row.course_id, {
                inviteCode: row.invite_code || undefined,
                amountPaid: enrollAmount ?? undefined,
                currency: currency || undefined,
            });
        }

        // Grant book entitlements when payment includes books (no-op if book_items empty)
        try {
            if (purchaseType === 'book_addon' || purchaseType === 'book_courier') {
                const enrolledForBooks = await courseService.isEnrolled(row.user_id, row.course_id);
                if (!enrolledForBooks && purchaseType === 'book_addon') {
                    throw Object.assign(new Error('Student must be enrolled to receive book add-on'), {
                        status: 400,
                    });
                }
            }
            const bookEntitlementService = require('./bookEntitlementService');
            await bookEntitlementService.grantFromPayment(row);
        } catch (bookErr) {
            console.error('Book entitlement grant failed (payment still accepted):', bookErr.message);
            if ((purchaseType === 'book_addon' || purchaseType === 'book_courier') && bookErr.status === 400) {
                throw bookErr;
            }
        }

        await db.query(
            `UPDATE course_payment_requests
             SET status = 'accepted',
                 reviewed_at = NOW(),
                 reviewed_by = $1,
                 acceptance_reason = $2,
                 updated_at = NOW()
             WHERE id = $3`,
            [adminUserId, accessReason || null, requestId]
        );

        if (purchaseType === 'courier_fee' || purchaseType === 'book_courier') {
            const bookCourierService = require('./bookCourierService');
            await bookCourierService.markPaidByPaymentRequest(requestId, {
                decrementStock: purchaseType === 'book_courier',
            });
        }

        try {
            const bookCommissionService = require('./bookCommissionService');
            await bookCommissionService.recordFromPaymentRequest(row);
        } catch (commErr) {
            console.error('Book commission record from payment failed:', commErr.message);
        }

        const userNotificationService = require('./userNotificationService');
        const bookOnly = isBookOnlyPurchaseType(purchaseType);
        const bookLabel = bookTitleFromItems(row.book_items);
        const bookNote =
            purchaseType === 'book_addon'
                ? ' Your book access has been unlocked.'
                : purchaseType === 'course_with_books'
                  ? ' Course and book access unlocked.'
                  : purchaseType === 'courier_fee'
                  ? ' Your courier fee payment was successful.'
                  : purchaseType === 'book_courier'
                  ? ' Your book order payment was successful.'
                  : '';
        const bookItemsParsed = parseBookItems(row.book_items);
        const notifyLink =
            purchaseType === 'book_courier' || purchaseType === 'courier_fee'
                ? (() => {
                      const bid = bookItemsParsed[0]?.bookId;
                      return bid ? `/student/books/${bid}/courier` : null;
                  })()
                : purchaseType === 'book_addon'
                  ? (() => {
                        const bid = bookItemsParsed[0]?.bookId;
                        return bid ? `/student/books/${bid}/read` : null;
                    })()
                  : null;

        await userNotificationService.create(row.user_id, {
            type: bookOnly ? 'book_payment_accepted' : 'payment_accepted',
            title: bookOnly ? 'Book payment accepted' : 'Payment accepted',
            body: bookOnly
                ? `Your payment for "${bookLabel}" has been accepted.${bookNote}`
                : `Your payment for "${courseTitle}" has been accepted. You now have access to the course.${bookNote}`,
            courseId: row.course_id,
            link: notifyLink,
        });

        const senderPhone = row.sender_phone && String(row.sender_phone).trim() ? String(row.sender_phone).trim() : null;
        if (senderPhone) {
            smsService.sendPaymentAcceptedSms(senderPhone, bookOnly ? bookLabel : courseTitle).catch((err) => {
                console.error('Payment accepted SMS failed:', err.message);
            });
        }

        return { accepted: true, requestId, purchaseType, bookOnly: bookOnly };
    } catch (err) {
        console.error('Error in acceptPaymentRequest:', err);
        throw err;
    }
}

/**
 * List payment requests for a student (e.g. for dashboard pending, history).
 */
async function getByStudent(userId, options = {}) {
    const { status = null, limit = 50 } = options;
    let whereClause = 'pr.user_id = $1';
    const params = [userId];
    let paramIndex = 2;
    if (status) {
        whereClause += ` AND pr.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
    }
    params.push(limit);
    const result = await db.query(
        `SELECT pr.id, pr.course_id, pr.user_id, pr.payment_method, pr.sender_phone,
                pr.transaction_id, pr.amount, pr.currency, pr.status, pr.coupon_code, pr.invite_code,
                pr.reviewed_at, pr.rejection_reason, pr.acceptance_reason, pr.created_at,
                pr.purchase_type, pr.book_items, pr.book_amount, pr.course_amount,
                c.title AS course_title, c.thumbnail_path, c.price, c.discount_price, c.currency AS course_currency,
                COALESCE(tp.name, u.email) AS teacher_name
         FROM course_payment_requests pr
         LEFT JOIN courses c ON c.id = pr.course_id
         LEFT JOIN users u ON c.teacher_id = u.id
         LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
         WHERE ${whereClause}
         ORDER BY pr.created_at DESC
         LIMIT $${paramIndex}`,
        params
    );
    return result.rows.map((row) => {
        let parsedBookItems = null;
        if (row.book_items) {
            try {
                parsedBookItems = typeof row.book_items === 'string' ? JSON.parse(row.book_items) : row.book_items;
            } catch (e) {}
        }
        const purchaseType = resolvePurchaseType(row);
        const bookOnly = isBookOnlyPurchaseType(purchaseType);
        return {
            id: row.id,
            courseId: row.course_id,
            userId: row.user_id,
            paymentMethod: row.payment_method,
            senderPhone: row.sender_phone,
            transactionId: row.transaction_id,
            amount: parseFloat(row.amount),
            currency: row.currency,
            status: row.status,
            couponCode: row.coupon_code,
            inviteCode: row.invite_code,
            reviewedAt: row.reviewed_at,
            rejectionReason: row.rejection_reason,
            acceptanceReason: row.acceptance_reason,
            createdAt: row.created_at,
            courseTitle: row.course_title,
            thumbnailPath: row.thumbnail_path,
            coursePrice: row.price ? parseFloat(row.price) : null,
            courseDiscountPrice: row.discount_price ? parseFloat(row.discount_price) : null,
            courseCurrency: row.course_currency,
            teacherName: row.teacher_name,
            purchaseType,
            isBookOnly: bookOnly,
            bookAmount: row.book_amount != null ? parseFloat(row.book_amount) : null,
            courseAmount: row.course_amount != null ? parseFloat(row.course_amount) : null,
            bookItems: parsedBookItems,
        };
    });
}

/**
 * Get a single payment request by id for a student (for invoice view). Returns null if not found or not owned.
 */
async function getByIdForStudent(requestId, userId) {
    const result = await db.query(
        `SELECT pr.id, pr.course_id, pr.user_id, pr.payment_method, pr.sender_phone,
                pr.transaction_id, pr.amount, pr.currency, pr.status, pr.coupon_code, pr.invite_code,
                pr.reviewed_at, pr.rejection_reason, pr.acceptance_reason, pr.created_at,
                pr.purchase_type, pr.book_items,
                c.title AS course_title, c.price, c.discount_price, c.currency AS course_currency,
                COALESCE(tp.name, u.email) AS teacher_name, u.email AS teacher_email
         FROM course_payment_requests pr
         LEFT JOIN courses c ON c.id = pr.course_id
         LEFT JOIN users u ON c.teacher_id = u.id
         LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
         WHERE pr.id = $1 AND pr.user_id = $2`,
        [requestId, userId]
    );
    const row = result.rows[0];
    if (!row) return null;
    let parsedBookItems = null;
    if (row.book_items) {
        try {
            parsedBookItems = typeof row.book_items === 'string' ? JSON.parse(row.book_items) : row.book_items;
        } catch (e) {}
    }
    const price = parseFloat(row.price) || 0;
    const discountPrice = row.discount_price ? parseFloat(row.discount_price) : null;
    return {
        id: row.id,
        courseId: row.course_id,
        userId: row.user_id,
        paymentMethod: row.payment_method,
        senderPhone: row.sender_phone,
        transactionId: row.transaction_id,
        amount: parseFloat(row.amount),
        currency: row.currency,
        status: row.status,
        couponCode: row.coupon_code,
        inviteCode: row.invite_code,
        reviewedAt: row.reviewed_at,
        rejectionReason: row.rejection_reason,
        acceptanceReason: row.acceptance_reason,
        createdAt: row.created_at,
        courseTitle: row.course_title,
        coursePrice: price,
        courseDiscountPrice: discountPrice,
        courseCurrency: row.course_currency,
        teacherName: row.teacher_name,
        teacherEmail: row.teacher_email,
        purchaseType: row.purchase_type,
        bookItems: parsedBookItems,
    };
}

/**
 * Reject a payment request. Sends decline SMS to sender_phone and creates a user notification.
 */
async function rejectPaymentRequest(requestId, adminUserId, reason = null) {
    const selectResult = await db.query(
        `SELECT pr.user_id, pr.sender_phone, pr.course_id, c.title AS course_title
         FROM course_payment_requests pr
         JOIN courses c ON c.id = pr.course_id
         WHERE pr.id = $1 AND pr.status = 'pending'`,
        [requestId]
    );
    const row = selectResult.rows[0];
    if (!row) return null;

    const result = await db.query(
        `UPDATE course_payment_requests
         SET status = 'rejected',
             reviewed_at = NOW(),
             reviewed_by = $1,
             rejection_reason = $2,
             updated_at = NOW()
         WHERE id = $3 AND status = 'pending'
         RETURNING id`,
        [adminUserId, reason || null, requestId]
    );
    if (!result.rows[0]) return null;

    const courseTitle = row.course_title || 'the course';

    // In-app notification for the student
    const userNotificationService = require('./userNotificationService');
    await userNotificationService.create(row.user_id, {
        type: 'payment_rejected',
        title: 'Payment request declined',
        body: `Your payment for "${courseTitle}" was declined. Please contact support if you have questions.`,
        courseId: row.course_id,
    });

    // SMS to the number provided at checkout (fire-and-forget)
    if (row.sender_phone && String(row.sender_phone).trim()) {
        smsService.sendPaymentDeclinedSms(row.sender_phone, courseTitle).catch((err) => {
            console.error('Payment declined SMS failed:', err.message);
        });
    }

    return { rejected: true, requestId };
}

/**
 * Idempotent: grant book entitlements for an accepted/pending payment request.
 */
async function ensureBookEntitlements(requestId) {
    if (!requestId) return [];
    const result = await db.query(`SELECT * FROM course_payment_requests WHERE id = $1`, [requestId]);
    const row = result.rows[0];
    if (!row) return [];
    const bookEntitlementService = require('./bookEntitlementService');
    return bookEntitlementService.grantFromPayment(row);
}

module.exports = {
    createPaymentRequest,
    listPaymentRequests,
    acceptPaymentRequest,
    rejectPaymentRequest,
    getByStudent,
    ensureBookEntitlements,
    getByIdForStudent,
    isBookOnlyPurchaseType,
    resolvePurchaseType,
    parseBookItems,
    bookTitleFromItems,
};
