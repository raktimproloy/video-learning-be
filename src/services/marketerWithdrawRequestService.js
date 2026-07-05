const db = require('../../db');
const { randomUUID } = require('crypto');
const marketerPaymentMethodService = require('./marketerPaymentMethodService');

/**
 * Sum of accepted withdraw amounts for a marketer
 */
async function getAcceptedWithdrawTotal(marketerId) {
    const result = await db.query(
        `SELECT COALESCE(SUM(amount::numeric), 0)::float as total
         FROM marketer_withdraw_requests
         WHERE marketer_id = $1 AND status = 'accepted'`,
        [marketerId]
    );
    return parseFloat(result.rows[0]?.total || 0);
}

/**
 * Create a withdrawal request. Amount is calculated from total_earnings - (accepted + pending).
 */
async function create(marketerId, { paymentMethodId }) {
    // Get total earnings
    const mRes = await db.query('SELECT total_earnings FROM marketers WHERE id = $1', [marketerId]);
    if (!mRes.rows[0]) throw new Error('Marketer not found');
    const totalEarnings = parseFloat(mRes.rows[0].total_earnings || 0);
    
    // Get total accepted + pending withdraws
    const wRes = await db.query(`
        SELECT COALESCE(SUM(amount::numeric), 0)::float as total 
        FROM marketer_withdraw_requests 
        WHERE marketer_id = $1 AND status IN ('accepted', 'pending')
    `, [marketerId]);
    const withdrawnOrPending = parseFloat(wRes.rows[0].total || 0);
    
    const withdrawable = Math.max(0, totalEarnings - withdrawnOrPending);

    if (withdrawable <= 0) throw new Error('No balance to withdraw');
    
    // Default currency to BDT
    const curr = 'BDT';

    let paymentMethodSnapshot = null;
    if (paymentMethodId) {
        const method = await marketerPaymentMethodService.getById(paymentMethodId, marketerId);
        if (!method) throw new Error('Payment method not found');
        paymentMethodSnapshot = { type: method.type, displayLabel: method.displayLabel, details: method.details };
    } else {
        throw new Error('Payment method is required');
    }

    const id = randomUUID();
    await db.query(
        `INSERT INTO marketer_withdraw_requests (id, marketer_id, amount, currency, payment_method_id, payment_method_snapshot, status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending')`,
        [id, marketerId, withdrawable, curr, paymentMethodId, JSON.stringify(paymentMethodSnapshot)]
    );
    return getById(id, marketerId);
}

/**
 * List requests for a marketer (own).
 */
async function listByMarketer(marketerId, options = {}) {
    const { limit = 50, offset = 0, status = null } = options;
    let where = 'WHERE marketer_id = $1';
    const params = [marketerId];
    let idx = 2;
    if (status) {
        where += ` AND status = $${idx++}`;
        params.push(status);
    }
    const countResult = await db.query(
        `SELECT COUNT(*)::int as total FROM marketer_withdraw_requests ${where}`,
        params.slice(0, idx - 1)
    );
    const total = countResult.rows[0]?.total || 0;

    params.push(limit, offset);
    const result = await db.query(
        `SELECT id, marketer_id, amount, currency, payment_method_id, payment_method_snapshot,
                status, receipt_image_path, rejection_reason, reviewed_at, reviewed_by, created_at
         FROM marketer_withdraw_requests
         ${where}
         ORDER BY created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params
    );
    return { requests: result.rows.map(row => mapRow(row)), total };
}

/**
 * Get one request by id; for marketer must be own.
 */
async function getById(id, marketerId = null) {
    let query = `SELECT w.*, pm.type as pm_type, pm.display_label as pm_display_label, pm.details as pm_details
                 FROM marketer_withdraw_requests w
                 LEFT JOIN marketer_payment_methods pm ON w.payment_method_id = pm.id
                 WHERE w.id = $1`;
    const params = [id];
    if (marketerId) {
        query += ' AND w.marketer_id = $2';
        params.push(marketerId);
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
        marketerId: row.marketer_id,
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
 * Admin: list all marketer withdraw requests.
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
        `SELECT w.id, w.marketer_id, w.amount, w.currency, w.payment_method_id, w.payment_method_snapshot,
                w.status, w.receipt_image_path, w.rejection_reason, w.reviewed_at, w.reviewed_by, w.created_at,
                m.email as marketer_email,
                m.name as marketer_name
         FROM marketer_withdraw_requests w
         JOIN marketers m ON w.marketer_id = m.id
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
            marketerId: row.marketer_id,
            marketerEmail: row.marketer_email,
            marketerName: row.marketer_name,
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
        `UPDATE marketer_withdraw_requests
         SET status = 'accepted', receipt_image_path = $1, rejection_reason = NULL,
             reviewed_at = NOW(), reviewed_by = $2
         WHERE id = $3 AND status = 'pending'
         RETURNING *`,
        [receiptImagePath.trim(), adminUserId, id]
    );
    if (!result.rows[0]) return null;
    
    // Update the withdrawn_amount in marketers table
    const reqAmount = parseFloat(result.rows[0].amount);
    const marketerId = result.rows[0].marketer_id;
    await db.query(
        `UPDATE marketers SET withdrawn_amount = withdrawn_amount + $1 WHERE id = $2`,
        [reqAmount, marketerId]
    );
    
    return mapRow(result.rows[0]);
}

/**
 * Admin: reject a request (with reason).
 */
async function reject(id, adminUserId, rejectionReason) {
    const reason = rejectionReason && String(rejectionReason).trim() ? String(rejectionReason).trim() : 'No reason provided';
    const result = await db.query(
        `UPDATE marketer_withdraw_requests
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
    listByMarketer,
    getById,
    listForAdmin,
    accept,
    reject,
};
