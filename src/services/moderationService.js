const db = require('../../db');
const sessionService = require('./sessionService');
const ttlCache = require('../utils/ttlCache');

const ABUSE_WINDOW_DAYS = Math.max(1, parseInt(process.env.DEVICE_ABUSE_WINDOW_DAYS || '7', 10));
const ABUSE_DISTINCT_THRESHOLD = Math.max(2, parseInt(process.env.DEVICE_ABUSE_DISTINCT_THRESHOLD || '4', 10));

const SYSTEM_SUSPEND_REASON =
    'Automatically suspended: unusual multi-device activity detected after a prior warning. This usually means the account is being shared across many devices, which violates our terms of use.';
const SYSTEM_WARNING_MESSAGE =
    "We've noticed your account being used on an unusually high number of devices recently. Sharing your account access with others is against our terms — please stop, or your account may be suspended.";

class ModerationService {
    async recordEvent(userId, { action, reason, actorType, actorAdminId = null, metadata = null }) {
        await db.query(
            `INSERT INTO user_moderation_events (user_id, action, reason, actor_type, actor_admin_id, metadata)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, action, reason, actorType, actorAdminId, metadata ? JSON.stringify(metadata) : null]
        );
    }

    async getHistory(userId) {
        const result = await db.query(
            `SELECT e.id, e.action, e.reason, e.actor_type, e.actor_admin_id, e.metadata, e.created_at,
                    a.email AS actor_admin_email
             FROM user_moderation_events e
             LEFT JOIN users a ON a.id = e.actor_admin_id
             WHERE e.user_id = $1
             ORDER BY e.created_at DESC`,
            [userId]
        );
        return result.rows;
    }

    /**
     * Runs after a successful login/session-create. Looks at how many distinct
     * devices this account has touched in the trailing window. First breach =
     * warning (recorded permanently on the user). Any breach after that ever
     * happens again (including after an admin reactivation) = suspend directly,
     * since the account was already warned once and chose not to correct.
     */
    async evaluateDeviceAbuse(userId) {
        const since = new Date(Date.now() - ABUSE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const distinctDevices = await sessionService.countDistinctDevicesSince(userId, since);
        if (distinctDevices <= ABUSE_DISTINCT_THRESHOLD) {
            return null;
        }

        const userRes = await db.query('SELECT warning_issued_at FROM users WHERE id = $1', [userId]);
        const alreadyWarned = !!userRes.rows[0]?.warning_issued_at;
        const metadata = { distinctDevices, windowDays: ABUSE_WINDOW_DAYS, threshold: ABUSE_DISTINCT_THRESHOLD };

        if (!alreadyWarned) {
            await db.query(
                `UPDATE users SET warning_issued_at = NOW(), warning_count = warning_count + 1 WHERE id = $1`,
                [userId]
            );
            await this.recordEvent(userId, {
                action: 'warning',
                reason: SYSTEM_WARNING_MESSAGE,
                actorType: 'system',
                metadata,
            });
            return { action: 'warning', message: SYSTEM_WARNING_MESSAGE };
        }

        await this.suspend(userId, null, SYSTEM_SUSPEND_REASON, { actorType: 'system', metadata });
        return { action: 'suspended', message: SYSTEM_SUSPEND_REASON };
    }

    async suspend(userId, adminId, reason, { actorType = 'admin', metadata = null } = {}) {
        await db.query(
            `UPDATE users SET status = 'suspended', suspended_reason = $1, suspended_at = NOW(), suspension_count = suspension_count + 1
             WHERE id = $2`,
            [reason, userId]
        );
        const revoked = await sessionService.revokeAllForUser(userId, actorType === 'admin' ? 'admin_suspend' : 'system_suspend');
        for (const row of revoked) {
            ttlCache.delete(`session:${row.jti}`);
        }
        await this.recordEvent(userId, {
            action: 'suspended',
            reason,
            actorType,
            actorAdminId: actorType === 'admin' ? adminId : null,
            metadata,
        });
        return { revokedSessions: revoked };
    }

    async reactivate(userId, adminId) {
        // Intentionally does NOT clear warning_issued_at/warning_count — a user who
        // was ever warned and later suspended goes straight to re-suspension on any
        // future abuse, without a second grace period.
        await db.query(`UPDATE users SET status = 'active', suspended_reason = NULL, suspended_at = NULL WHERE id = $1`, [userId]);
        await this.recordEvent(userId, {
            action: 'reactivated',
            reason: 'Reactivated by admin',
            actorType: 'admin',
            actorAdminId: adminId,
        });
    }
}

module.exports = new ModerationService();
