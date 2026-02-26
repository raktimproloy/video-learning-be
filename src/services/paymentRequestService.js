const db = require('../../db');
const smsService = require('../utils/smsService');

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
    } = data;

    const result = await db.query(
        `INSERT INTO course_payment_requests (
            course_id, user_id, payment_method, sender_phone, transaction_id,
            amount, currency, coupon_code, invite_code
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
        ]
    );

    // Notify student by SMS (fire-and-forget; do not fail the request if SMS fails)
    const phone = senderPhone && String(senderPhone).trim() ? String(senderPhone).trim() : null;
    if (phone) {
        smsService.sendPaymentPendingSms(phone).catch((err) => {
            console.error('Payment pending SMS failed:', err.message);
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
            pr.created_at,
            c.title AS course_title,
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
        requests: result.rows.map((row) => ({
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
            createdAt: row.created_at,
            courseTitle: row.course_title,
            userEmail: row.user_email,
            userName: row.user_name,
        })),
        total,
    };
}

/**
 * Accept a payment request: enroll user in course (apply coupon if any) and update status.
 * Then creates a user notification and optionally calls the message API with sender phone.
 */
async function acceptPaymentRequest(requestId, adminUserId) {
    const request = await db.query(
        `SELECT pr.*, c.title AS course_title FROM course_payment_requests pr
         JOIN courses c ON c.id = pr.course_id
         WHERE pr.id = $1 AND pr.status = $2`,
        [requestId, 'pending']
    );
    if (!request.rows[0]) {
        return null;
    }
    const row = request.rows[0];
    const courseTitle = row.course_title || 'Course';

    await db.query('BEGIN');
    try {
        if (row.coupon_code) {
            const couponApplyService = require('./couponApplyService');
            await couponApplyService.applyCoupon(row.coupon_code, row.user_id);
        }
        const courseService = require('./courseService');
        const amountPaid = row.amount != null && !Number.isNaN(parseFloat(row.amount)) ? parseFloat(row.amount) : null;
        const currency = (row.currency && String(row.currency).trim()) || null;
        await courseService.enrollUser(row.user_id, row.course_id, {
            inviteCode: row.invite_code || undefined,
            amountPaid: amountPaid ?? undefined,
            currency: currency || undefined,
        });
        await db.query(
            `UPDATE course_payment_requests
             SET status = 'accepted', reviewed_at = NOW(), reviewed_by = $1, updated_at = NOW()
             WHERE id = $2`,
            [adminUserId, requestId]
        );
        await db.query('COMMIT');

        // Create notification for student
        const userNotificationService = require('./userNotificationService');
        await userNotificationService.create(row.user_id, {
            type: 'payment_accepted',
            title: 'Payment accepted',
            body: `Your payment for "${courseTitle}" has been accepted. You now have access to the course.`,
            courseId: row.course_id,
        });

        // Optional: send payment-accepted SMS via BulkSMS BD (same util as pending SMS)
        if (row.sender_phone) {
            smsService.sendPaymentAcceptedSms(row.sender_phone, courseTitle).catch((err) => {
                console.error('Payment accepted SMS failed:', err.message);
            });
        }

        return { accepted: true, requestId };
    } catch (err) {
        await db.query('ROLLBACK');
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
                pr.reviewed_at, pr.created_at,
                c.title AS course_title, c.thumbnail_path, c.price, c.discount_price, c.currency AS course_currency,
                COALESCE(tp.name, u.email) AS teacher_name
         FROM course_payment_requests pr
         JOIN courses c ON c.id = pr.course_id
         LEFT JOIN users u ON c.teacher_id = u.id
         LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
         WHERE ${whereClause}
         ORDER BY pr.created_at DESC
         LIMIT $${paramIndex}`,
        params
    );
    return result.rows.map((row) => ({
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
        createdAt: row.created_at,
        courseTitle: row.course_title,
        thumbnailPath: row.thumbnail_path,
        coursePrice: row.price ? parseFloat(row.price) : null,
        courseDiscountPrice: row.discount_price ? parseFloat(row.discount_price) : null,
        courseCurrency: row.course_currency,
        teacherName: row.teacher_name,
    }));
}

/**
 * Get a single payment request by id for a student (for invoice view). Returns null if not found or not owned.
 */
async function getByIdForStudent(requestId, userId) {
    const result = await db.query(
        `SELECT pr.id, pr.course_id, pr.user_id, pr.payment_method, pr.sender_phone,
                pr.transaction_id, pr.amount, pr.currency, pr.status, pr.coupon_code, pr.invite_code,
                pr.reviewed_at, pr.created_at,
                c.title AS course_title, c.price, c.discount_price, c.currency AS course_currency,
                COALESCE(tp.name, u.email) AS teacher_name, u.email AS teacher_email
         FROM course_payment_requests pr
         JOIN courses c ON c.id = pr.course_id
         LEFT JOIN users u ON c.teacher_id = u.id
         LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
         WHERE pr.id = $1 AND pr.user_id = $2`,
        [requestId, userId]
    );
    const row = result.rows[0];
    if (!row) return null;
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
        createdAt: row.created_at,
        courseTitle: row.course_title,
        coursePrice: price,
        courseDiscountPrice: discountPrice,
        courseCurrency: row.course_currency,
        teacherName: row.teacher_name,
        teacherEmail: row.teacher_email,
    };
}

/**
 * Reject a payment request. Sends decline SMS to sender_phone if present.
 */
async function rejectPaymentRequest(requestId, adminUserId) {
    const selectResult = await db.query(
        `SELECT pr.sender_phone, c.title AS course_title
         FROM course_payment_requests pr
         JOIN courses c ON c.id = pr.course_id
         WHERE pr.id = $1 AND pr.status = 'pending'`,
        [requestId]
    );
    const row = selectResult.rows[0];
    if (!row) return null;

    const result = await db.query(
        `UPDATE course_payment_requests
         SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $1, updated_at = NOW()
         WHERE id = $2 AND status = 'pending'
         RETURNING id`,
        [adminUserId, requestId]
    );
    if (!result.rows[0]) return null;

    if (row.sender_phone) {
        smsService.sendPaymentDeclinedSms(row.sender_phone, row.course_title).catch((err) => {
            console.error('Payment declined SMS failed:', err.message);
        });
    }

    return { rejected: true, requestId };
}

module.exports = {
    createPaymentRequest,
    listPaymentRequests,
    acceptPaymentRequest,
    rejectPaymentRequest,
    getByStudent,
    getByIdForStudent,
};
