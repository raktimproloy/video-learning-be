const db = require('../../db');
const parseUserAgent = require('../utils/uaParser');

const MAX_CONCURRENT_DEVICES = Math.max(1, parseInt(process.env.MAX_CONCURRENT_DEVICES || '2', 10));

class SessionService {
    get maxConcurrentDevices() {
        return MAX_CONCURRENT_DEVICES;
    }

    /**
     * Flips any active-but-past-expiry rows to 'expired', then returns the
     * remaining active sessions for the user (oldest first).
     */
    async countActive(userId) {
        await db.query(
            `UPDATE user_sessions SET status = 'expired'
             WHERE user_id = $1 AND status = 'active' AND expires_at <= NOW()`,
            [userId]
        );
        const result = await db.query(
            `SELECT id, device_id, device_label, device_type, ip_address, created_at, last_seen_at, expires_at
             FROM user_sessions
             WHERE user_id = $1 AND status = 'active'
             ORDER BY created_at ASC`,
            [userId]
        );
        return result.rows;
    }

    async findActiveSessionByDeviceId(userId, deviceId) {
        if (!deviceId) return null;
        const result = await db.query(
            `SELECT * FROM user_sessions WHERE user_id = $1 AND device_id = $2 AND status = 'active' LIMIT 1`,
            [userId, deviceId]
        );
        return result.rows[0] || null;
    }

    async create({ userId, jti, deviceId, req, expiresAt }) {
        const ua = req.headers['user-agent'] || '';
        const { browser, os, deviceType } = parseUserAgent(ua);
        const label = `${browser} on ${os}`;
        const ip = req.ip || req.headers['x-forwarded-for'] || null;
        const result = await db.query(
            `INSERT INTO user_sessions (user_id, jti, device_id, device_label, device_type, user_agent, ip_address, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [userId, jti, deviceId, label, deviceType, ua, ip, expiresAt]
        );
        return result.rows[0];
    }

    /** Update an existing session in-place with a new jti/expiry (role switch — doesn't consume a device slot). */
    async reissue(sessionId, { jti, expiresAt }) {
        const result = await db.query(
            `UPDATE user_sessions SET jti = $1, expires_at = $2, last_seen_at = NOW() WHERE id = $3 RETURNING *`,
            [jti, expiresAt, sessionId]
        );
        return result.rows[0];
    }

    async findByJti(jti) {
        const result = await db.query(`SELECT * FROM user_sessions WHERE jti = $1`, [jti]);
        return result.rows[0] || null;
    }

    /**
     * Returns the session + the owning user's current moderation status, for
     * middleware checks. Also opportunistically bumps last_seen_at — this is
     * only called on a cache miss (see authMiddleware's ttlCache), so it stays
     * bounded to roughly once per cache-TTL window per active session.
     */
    async findActiveByJti(jti) {
        const result = await db.query(
            `UPDATE user_sessions s SET last_seen_at = NOW()
             FROM users u
             WHERE u.id = s.user_id AND s.jti = $1
             RETURNING s.id, s.status AS session_status, s.expires_at, u.status AS user_status, u.suspended_reason`,
            [jti]
        );
        const row = result.rows[0];
        if (!row) return null;
        if (row.session_status !== 'active') return null;
        if (new Date(row.expires_at).getTime() <= Date.now()) return null;
        return { sessionId: row.id, userStatus: row.user_status, suspendedReason: row.suspended_reason };
    }

    async revoke(sessionId, reason) {
        const result = await db.query(
            `UPDATE user_sessions SET status = 'revoked', revoked_reason = $1, revoked_at = NOW()
             WHERE id = $2 AND status = 'active' RETURNING *`,
            [reason, sessionId]
        );
        return result.rows[0] || null;
    }

    async revokeAllForUser(userId, reason) {
        const result = await db.query(
            `UPDATE user_sessions SET status = 'revoked', revoked_reason = $1, revoked_at = NOW()
             WHERE user_id = $2 AND status = 'active' RETURNING id, jti`,
            [reason, userId]
        );
        return result.rows;
    }

    /** Active + historical sessions for a user (self-service and admin views). */
    async listForUser(userId) {
        const result = await db.query(
            `SELECT id, device_id, device_label, device_type, ip_address, status, revoked_reason,
                    created_at, last_seen_at, expires_at, revoked_at
             FROM user_sessions
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [userId]
        );
        return result.rows;
    }

    /** Count of distinct devices seen for a user within a trailing window (abuse detection signal). */
    async countDistinctDevicesSince(userId, sinceDate) {
        const result = await db.query(
            `SELECT COUNT(DISTINCT device_id)::int AS count FROM user_sessions
             WHERE user_id = $1 AND created_at > $2`,
            [userId, sinceDate]
        );
        return result.rows[0]?.count || 0;
    }
}

module.exports = new SessionService();
