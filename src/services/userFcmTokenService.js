const db = require('../../db');

/**
 * Save or update FCM token for a user (one token per user for simplicity; can be extended to multiple devices).
 */
async function saveToken(userId, token) {
    if (!userId || !token || !String(token).trim()) return null;
    const t = String(token).trim();
    await db.query(
        `INSERT INTO user_fcm_tokens (user_id, token) VALUES ($1, $2)
         ON CONFLICT (user_id, token) DO UPDATE SET created_at = NOW()`,
        [userId, t]
    );
    return t;
}

/**
 * Get the most recent FCM token for a user.
 */
async function getTokenByUserId(userId) {
    if (!userId) return null;
    const result = await db.query(
        `SELECT token FROM user_fcm_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
    );
    return result.rows[0]?.token || null;
}

/**
 * Get all FCM tokens for a user (all devices: laptop, phone, etc.).
 */
async function getAllTokensByUserId(userId) {
    if (!userId) return [];
    const result = await db.query(
        `SELECT token FROM user_fcm_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
    );
    return result.rows.map((r) => r.token).filter(Boolean);
}

/**
 * Remove a single FCM token for a user (e.g. when FCM reports it invalid).
 */
async function removeToken(userId, token) {
    if (!userId || !token || !String(token).trim()) return;
    const t = String(token).trim();
    await db.query(
        `DELETE FROM user_fcm_tokens WHERE user_id = $1 AND token = $2`,
        [userId, t]
    );
}

module.exports = {
    saveToken,
    getTokenByUserId,
    getAllTokensByUserId,
    removeToken,
};
