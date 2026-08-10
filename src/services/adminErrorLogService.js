'use strict';
const db = require('../../db');

class AdminErrorLogService {
    /**
     * Get paginated error logs with filters.
     */
    async getErrorLogs({ page = 1, limit = 50, severity, source, resolved, search, userId, dateFrom, dateTo } = {}) {
        const offset = (page - 1) * limit;
        const conditions = [];
        const values = [];
        let idx = 1;

        if (severity && severity !== 'all') {
            conditions.push(`severity = $${idx++}`);
            values.push(severity);
        }
        if (source && source !== 'all') {
            conditions.push(`source = $${idx++}`);
            values.push(source);
        }
        if (resolved !== undefined && resolved !== null && resolved !== 'all') {
            conditions.push(`resolved = $${idx++}`);
            values.push(resolved === 'true' || resolved === true);
        }
        if (userId) {
            conditions.push(`user_id = $${idx++}`);
            values.push(userId);
        }
        if (dateFrom) {
            conditions.push(`created_at >= $${idx++}`);
            values.push(new Date(dateFrom));
        }
        if (dateTo) {
            conditions.push(`created_at <= $${idx++}`);
            values.push(new Date(dateTo));
        }
        if (search && search.trim()) {
            conditions.push(`(title ILIKE $${idx} OR message ILIKE $${idx} OR path ILIKE $${idx} OR user_email ILIKE $${idx})`);
            values.push(`%${search.trim()}%`);
            idx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Total count
        const countRes = await db.query(
            `SELECT COUNT(*) FROM system_error_logs ${where}`,
            values
        );
        const total = parseInt(countRes.rows[0].count, 10);

        // Paginated data
        const dataRes = await db.query(
            `SELECT 
                id, title, message, error_code, method, path, 
                user_id, user_role, user_email, severity, source,
                resolved, resolved_at, resolution_note,
                created_at, updated_at,
                context
             FROM system_error_logs
             ${where}
             ORDER BY created_at DESC
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...values, limit, offset]
        );

        return {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            logs: dataRes.rows,
        };
    }

    /**
     * Get a single error log by ID with full details.
     */
    async getErrorLogById(id) {
        const res = await db.query(
            `SELECT 
                sel.*,
                COALESCE(sp.name, tp.name, u.email) as user_display_name
             FROM system_error_logs sel
             LEFT JOIN users u ON sel.user_id = u.id
             LEFT JOIN student_profiles sp ON sel.user_id = sp.user_id
             LEFT JOIN teacher_profiles tp ON sel.user_id = tp.user_id
             WHERE sel.id = $1`,
            [id]
        );
        return res.rows[0] || null;
    }

    /**
     * Mark an error log as resolved.
     */
    async resolveErrorLog(id, adminId, note = null) {
        const res = await db.query(
            `UPDATE system_error_logs
             SET resolved = true, resolved_at = NOW(), resolved_by_admin_id = $2, resolution_note = $3, updated_at = NOW()
             WHERE id = $1
             RETURNING id, resolved, resolved_at, resolution_note`,
            [id, adminId, note]
        );
        if (res.rows.length === 0) throw new Error('Error log not found');
        return res.rows[0];
    }

    /**
     * Mark an error log as unresolved.
     */
    async unresolveErrorLog(id) {
        const res = await db.query(
            `UPDATE system_error_logs
             SET resolved = false, resolved_at = NULL, resolved_by_admin_id = NULL, resolution_note = NULL, updated_at = NOW()
             WHERE id = $1
             RETURNING id, resolved`,
            [id]
        );
        if (res.rows.length === 0) throw new Error('Error log not found');
        return res.rows[0];
    }

    /**
     * Bulk resolve multiple error logs.
     */
    async bulkResolve(ids, adminId, note = null) {
        if (!ids || ids.length === 0) return { count: 0 };
        const res = await db.query(
            `UPDATE system_error_logs
             SET resolved = true, resolved_at = NOW(), resolved_by_admin_id = $2, resolution_note = $3, updated_at = NOW()
             WHERE id = ANY($1::uuid[]) AND resolved = false
             RETURNING id`,
            [ids, adminId, note]
        );
        return { count: res.rows.length };
    }

    /**
     * Delete an error log (admin only).
     */
    async deleteErrorLog(id) {
        const res = await db.query(
            `DELETE FROM system_error_logs WHERE id = $1 RETURNING id`,
            [id]
        );
        if (res.rows.length === 0) throw new Error('Error log not found');
        return { deleted: true };
    }

    /**
     * Get summary stats for dashboard cards.
     */
    async getErrorStats() {
        const res = await db.query(`
            SELECT
                COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h,
                COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS last_7d,
                COUNT(*) FILTER (WHERE resolved = false) AS unresolved_total,
                COUNT(*) FILTER (WHERE resolved = false AND severity = 'critical') AS unresolved_critical,
                COUNT(*) FILTER (WHERE resolved = false AND severity = 'error') AS unresolved_error,
                COUNT(*) FILTER (WHERE resolved = false AND severity = 'warn') AS unresolved_warn,
                COUNT(*) FILTER (WHERE source = 'api' AND resolved = false) AS api_unresolved,
                COUNT(*) FILTER (WHERE source = 'worker' AND resolved = false) AS worker_unresolved,
                COUNT(*) FILTER (WHERE source = 'system' AND resolved = false) AS system_unresolved,
                COUNT(*) AS total_all_time
            FROM system_error_logs
        `);

        const recentTrend = await db.query(`
            SELECT 
                DATE_TRUNC('hour', created_at) as hour,
                COUNT(*) as count,
                severity
            FROM system_error_logs
            WHERE created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY hour, severity
            ORDER BY hour ASC
        `);

        return {
            stats: res.rows[0],
            recentTrend: recentTrend.rows,
        };
    }
}

module.exports = new AdminErrorLogService();
