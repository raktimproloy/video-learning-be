const sessionService = require('../services/sessionService');
const moderationService = require('../services/moderationService');
const db = require('../../db');

class AdminUserModerationController {
    async getSessions(req, res) {
        try {
            const rows = await sessionService.listForUser(req.params.id);
            const sessions = rows.map((r) => ({
                id: r.id,
                deviceId: r.device_id,
                deviceLabel: r.device_label,
                deviceType: r.device_type,
                ipAddress: r.ip_address,
                status: r.status,
                revokedReason: r.revoked_reason,
                createdAt: r.created_at,
                lastSeenAt: r.last_seen_at,
                expiresAt: r.expires_at,
                revokedAt: r.revoked_at,
            }));
            res.json({ sessions });
        } catch (error) {
            console.error('Admin get user sessions error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getHistory(req, res) {
        try {
            const rows = await moderationService.getHistory(req.params.id);
            const events = rows.map((r) => ({
                id: r.id,
                action: r.action,
                reason: r.reason,
                actorType: r.actor_type,
                actorAdminEmail: r.actor_admin_email,
                metadata: r.metadata,
                createdAt: r.created_at,
            }));
            res.json({ events });
        } catch (error) {
            console.error('Admin get moderation history error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async suspend(req, res) {
        try {
            const { id } = req.params;
            const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
            if (!reason) {
                return res.status(400).json({ error: 'A suspension reason is required' });
            }

            const userRes = await db.query('SELECT id FROM users WHERE id = $1', [id]);
            if (userRes.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            await moderationService.suspend(id, req.admin.id, reason, { actorType: 'admin' });
            res.json({ success: true });
        } catch (error) {
            console.error('Admin suspend user error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async reactivate(req, res) {
        try {
            const { id } = req.params;
            const userRes = await db.query('SELECT id FROM users WHERE id = $1', [id]);
            if (userRes.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
            await moderationService.reactivate(id, req.admin.id);
            res.json({ success: true });
        } catch (error) {
            console.error('Admin reactivate user error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async revokeSession(req, res) {
        try {
            const { sessionId } = req.params;
            const revoked = await sessionService.revoke(sessionId, 'admin_revoked');
            if (!revoked) {
                return res.status(404).json({ error: 'Active session not found' });
            }
            const ttlCache = require('../utils/ttlCache');
            ttlCache.delete(`session:${revoked.jti}`);
            res.json({ success: true });
        } catch (error) {
            console.error('Admin revoke session error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AdminUserModerationController();
