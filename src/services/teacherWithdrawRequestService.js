const db = require('../../db');
const { randomUUID } = require('crypto');
const courseService = require('./courseService');
const teacherPaymentMethodService = require('./teacherPaymentMethodService');

/**
 * Sum of accepted withdraw amounts for a teacher (so we can subtract from withdrawable).
 */
async function getAcceptedWithdrawTotal(teacherId) {
    const result = await db.query(
        `SELECT COALESCE(SUM(amount::numeric), 0)::float as total
         FROM teacher_withdraw_requests
         WHERE teacher_id = $1 AND status = 'accepted'`,
        [teacherId]
    );
    return parseFloat(result.rows[0]?.total || 0);
}

/**
 * Create a withdrawal request. Validates amount <= withdrawable and payment method belongs to teacher.
 */
async function create(teacherId, { amount, currency, paymentMethodId }) {
    const data = await courseService.getTeacherRevenueDetailed(teacherId);
    const acceptedTotal = await getAcceptedWithdrawTotal(teacherId);
    const withdrawable = Math.max(0, data.withdrawable - acceptedTotal);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) throw new Error('Invalid amount');
    if (amt > withdrawable) throw new Error('Amount exceeds withdrawable balance');
    const curr = (currency && String(currency).trim()) || data.currency || 'USD';

    let paymentMethodSnapshot = null;
    if (paymentMethodId) {
        const method = await teacherPaymentMethodService.getById(paymentMethodId, teacherId);
        if (!method) throw new Error('Payment method not found');
        paymentMethodSnapshot = { type: method.type, displayLabel: method.displayLabel, details: method.details };
    } else {
        throw new Error('Payment method is required');
    }

    const id = randomUUID();
    await db.query(
        `INSERT INTO teacher_withdraw_requests (id, teacher_id, amount, currency, payment_method_id, payment_method_snapshot, status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending')`,
        [id, teacherId, amt, curr, paymentMethodId, JSON.stringify(paymentMethodSnapshot)]
    );
    return getById(id, teacherId);
}

/**
 * List requests for a teacher (own).
 */
async function listByTeacher(teacherId, options = {}) {
    const { limit = 50, offset = 0, status = null } = options;
    let where = 'WHERE teacher_id = $1';
    const params = [teacherId];
    let idx = 2;
    if (status) {
        where += ` AND status = $${idx++}`;
        params.push(status);
    }
    params.push(limit, offset);
    const result = await db.query(
        `SELECT id, teacher_id, amount, currency, payment_method_id, payment_method_snapshot,
                status, receipt_image_path, rejection_reason, reviewed_at, reviewed_by, created_at
         FROM teacher_withdraw_requests
         ${where}
         ORDER BY created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params
    );
    return result.rows.map(row => mapRow(row));
}

/**
 * Get one request by id; for teacher must be own.
 */
async function getById(id, teacherId = null) {
    let query = `SELECT w.*, pm.type as pm_type, pm.display_label as pm_display_label, pm.details as pm_details
                 FROM teacher_withdraw_requests w
                 LEFT JOIN teacher_payment_methods pm ON w.payment_method_id = pm.id
                 WHERE w.id = $1`;
    const params = [id];
    if (teacherId) {
        query += ' AND w.teacher_id = $2';
        params.push(teacherId);
    }
    const result = await db.query(query, params);
    if (!result.rows[0]) return null;
    return mapRow(result.rows[0], true);
}

function mapRow(row, withJoin = false) {
    const snapshot = row.payment_method_snapshot;
    const parsed = typeof snapshot === 'string' ? (snapshot ? JSON.parse(snapshot) : null) : snapshot;
    const out = {
        id: row.id,
        teacherId: row.teacher_id,
        amount: parseFloat(row.amount),
        currency: row.currency,
        paymentMethodId: row.payment_method_id,
        paymentMethodSnapshot: parsed,
        status: row.status,
        receiptImagePath: row.receipt_image_path,
        rejectionReason: row.rejection_reason,
        reviewedAt: row.reviewed_at,
        reviewedBy: row.reviewed_by,
        createdAt: row.created_at,
    };
    if (withJoin && row.pm_type) {
        out.paymentMethodType = row.pm_type;
        out.paymentMethodDisplayLabel = row.pm_display_label;
    }
    return out;
}

/**
 * Admin: list all teacher withdraw requests (with teacher info).
 */
async function listForAdmin(options = {}) {
    const { limit = 50, offset = 0, status = null } = options;
    let where = '1=1';
    const params = [];
    let idx = 1;
    if (status) {
        where += ` AND w.status = $${idx++}`;
        params.push(status);
    }
    params.push(limit, offset);
    const result = await db.query(
        `SELECT w.id, w.teacher_id, w.amount, w.currency, w.payment_method_id, w.payment_method_snapshot,
                w.status, w.receipt_image_path, w.rejection_reason, w.reviewed_at, w.reviewed_by, w.created_at,
                u.email as teacher_email,
                COALESCE(tp.name, u.email) as teacher_name
         FROM teacher_withdraw_requests w
         JOIN users u ON w.teacher_id = u.id
         LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
         WHERE ${where}
         ORDER BY w.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params
    );
    return result.rows.map(row => {
        const snapshot = row.payment_method_snapshot;
        const parsed = typeof snapshot === 'string' ? (snapshot ? JSON.parse(snapshot) : null) : snapshot;
        return {
            id: row.id,
            teacherId: row.teacher_id,
            teacherEmail: row.teacher_email,
            teacherName: row.teacher_name,
            amount: parseFloat(row.amount),
            currency: row.currency,
            paymentMethodSnapshot: parsed,
            status: row.status,
            receiptImagePath: row.receipt_image_path,
            rejectionReason: row.rejection_reason,
            reviewedAt: row.reviewed_at,
            reviewedBy: row.reviewed_by,
            createdAt: row.created_at,
        };
    });
}

/**
 * Admin: accept a request (requires receipt image path).
 */
async function accept(id, adminUserId, receiptImagePath) {
    if (!receiptImagePath || !String(receiptImagePath).trim()) {
        throw new Error('Receipt image is required to accept');
    }
    const result = await db.query(
        `UPDATE teacher_withdraw_requests
         SET status = 'accepted', receipt_image_path = $1, rejection_reason = NULL,
             reviewed_at = NOW(), reviewed_by = $2
         WHERE id = $3 AND status = 'pending'
         RETURNING *`,
        [receiptImagePath.trim(), adminUserId, id]
    );
    if (!result.rows[0]) return null;
    return mapRow(result.rows[0]);
}

/**
 * Admin: reject a request (with reason).
 */
async function reject(id, adminUserId, rejectionReason) {
    const reason = rejectionReason && String(rejectionReason).trim() ? String(rejectionReason).trim() : 'No reason provided';
    const result = await db.query(
        `UPDATE teacher_withdraw_requests
         SET status = 'rejected', rejection_reason = $1, receipt_image_path = NULL,
             reviewed_at = NOW(), reviewed_by = $2
         WHERE id = $3 AND status = 'pending'
         RETURNING *`,
        [reason, adminUserId, id]
    );
    if (!result.rows[0]) return null;
    return mapRow(result.rows[0]);
}

module.exports = {
    getAcceptedWithdrawTotal,
    create,
    listByTeacher,
    getById,
    listForAdmin,
    accept,
    reject,
};
