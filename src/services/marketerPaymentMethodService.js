const db = require('../../db');
const { randomUUID } = require('crypto');

const TYPES = ['bank', 'card', 'bkash', 'nagad', 'rocket'];

/**
 * List payment methods for a marketer.
 */
async function list(marketerId) {
    const result = await db.query(
        `SELECT id, marketer_id, type, display_label, details, created_at
         FROM marketer_payment_methods
         WHERE marketer_id = $1
         ORDER BY type, created_at`,
        [marketerId]
    );
    return result.rows.map(row => ({
        id: row.id,
        marketerId: row.marketer_id,
        type: row.type,
        displayLabel: row.display_label,
        details: typeof row.details === 'string' ? JSON.parse(row.details) : (row.details || {}),
        createdAt: row.created_at,
    }));
}

/**
 * Add a payment method. details shape depends on type:
 * - bank: { bankName, accountHolderName, accountNumber, routingNumber, accountType, country }
 * - card: { cardHolderName, last4, cardType, expiryMonth, expiryYear }
 * - bkash/nagad/rocket: { phone, accountHolderName }
 */
async function add(marketerId, { type, displayLabel, details }) {
    if (!TYPES.includes(type)) {
        throw new Error('Invalid payment method type');
    }
    const label = (displayLabel && String(displayLabel).trim()) || getDefaultLabel(type, details);
    const id = randomUUID();
    const detailsJson = typeof details === 'object' ? JSON.stringify(details) : '{}';
    await db.query(
        `INSERT INTO marketer_payment_methods (id, marketer_id, type, display_label, details)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [id, marketerId, type, label, detailsJson]
    );
    return getById(id, marketerId);
}

function getDefaultLabel(type, details) {
    const d = details || {};
    if (type === 'bank') return (d.bankName || 'Bank') + ' •••' + (d.accountNumber ? String(d.accountNumber).slice(-4) : '');
    if (type === 'card') return (d.cardType || 'Card') + ' ****' + (d.last4 || '');
    if (['bkash', 'nagad', 'rocket'].includes(type)) {
        const phone = d.phone || '';
        const masked = phone.length > 4 ? phone.slice(0, 2) + '***' + phone.slice(-3) : '***';
        return (type.charAt(0).toUpperCase() + type.slice(1)) + ' ' + masked;
    }
    return type;
}

/**
 * Get one method by id; ensure marketer owns it.
 */
async function getById(id, marketerId) {
    const result = await db.query(
        `SELECT id, marketer_id, type, display_label, details, created_at
         FROM marketer_payment_methods
         WHERE id = $1 AND marketer_id = $2`,
        [id, marketerId]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
        id: row.id,
        marketerId: row.marketer_id,
        type: row.type,
        displayLabel: row.display_label,
        details: typeof row.details === 'string' ? JSON.parse(row.details) : (row.details || {}),
        createdAt: row.created_at,
    };
}

/**
 * Update a payment method (display_label and/or details).
 */
async function update(id, marketerId, { displayLabel, details }) {
    const existing = await getById(id, marketerId);
    if (!existing) return null;
    const updates = [];
    const values = [];
    let i = 1;
    if (displayLabel !== undefined) {
        updates.push(`display_label = $${i++}`);
        values.push(String(displayLabel).trim() || existing.displayLabel);
    }
    if (details !== undefined) {
        updates.push(`details = $${i++}::jsonb`);
        values.push(typeof details === 'object' ? JSON.stringify(details) : details);
    }
    if (updates.length === 0) return existing;
    values.push(id, marketerId);
    await db.query(
        `UPDATE marketer_payment_methods SET ${updates.join(', ')}, created_at = created_at
         WHERE id = $${i++} AND marketer_id = $${i}`,
        values
    );
    return getById(id, marketerId);
}

/**
 * Delete a payment method.
 */
async function remove(id, marketerId) {
    const result = await db.query(
        'DELETE FROM marketer_payment_methods WHERE id = $1 AND marketer_id = $2 RETURNING id',
        [id, marketerId]
    );
    return result.rowCount > 0;
}

module.exports = {
    list,
    add,
    getById,
    update,
    remove,
    TYPES,
};
