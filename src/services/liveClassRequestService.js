const db = require('../../db');

class LiveClassRequestService {
    /** Check if course has a pending request (by teacher or for admin check). */
    async getPendingByCourseId(courseId) {
        const result = await db.query(
            'SELECT * FROM live_class_requests WHERE course_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
            [courseId, 'pending']
        );
        return result.rows[0] || null;
    }

    /** Create a pending request. Fails if course already has has_live_class or a pending request exists. */
    async create(courseId, requestedByUserId) {
        const result = await db.query(
            `INSERT INTO live_class_requests (course_id, requested_by, status)
             VALUES ($1, $2, 'pending')
             RETURNING *`,
            [courseId, requestedByUserId]
        );
        return result.rows[0];
    }

    /** List for admin: all or by status, with course and teacher info. */
    async listForAdmin(options = {}) {
        const { status = 'pending', limit = 50, offset = 0 } = options;
        const params = [];
        let where = '';
        if (status && status !== 'all') {
            params.push(status);
            where = 'WHERE lcr.status = $1';
        }
        params.push(limit, offset);
        const limitParam = params.length - 1;
        const offsetParam = params.length;

        const result = await db.query(
            `SELECT 
                lcr.id,
                lcr.course_id,
                lcr.requested_by,
                lcr.status,
                lcr.created_at,
                lcr.reviewed_at,
                lcr.reviewed_by,
                c.title AS course_title,
                u.email AS teacher_email,
                COALESCE(tp.name, u.email) AS teacher_name
             FROM live_class_requests lcr
             JOIN courses c ON c.id = lcr.course_id
             JOIN users u ON u.id = lcr.requested_by
             LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
             ${where}
             ORDER BY lcr.created_at DESC
             LIMIT $${limitParam} OFFSET $${offsetParam}`,
            params
        );

        const countResult = await db.query(
            `SELECT COUNT(*)::int AS total FROM live_class_requests lcr ${where}`,
            status && status !== 'all' ? [status] : []
        );
        const total = countResult.rows[0]?.total || 0;

        return { requests: result.rows, total };
    }

    /** Get one request by id (for admin). */
    async getById(id) {
        const result = await db.query(
            `SELECT 
                lcr.*,
                c.title AS course_title,
                c.has_live_class AS course_has_live_class,
                u.email AS teacher_email,
                COALESCE(tp.name, u.email) AS teacher_name
             FROM live_class_requests lcr
             JOIN courses c ON c.id = lcr.course_id
             JOIN users u ON u.id = lcr.requested_by
             LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
             WHERE lcr.id = $1`,
            [id]
        );
        return result.rows[0] || null;
    }

    /** Accept: set course.has_live_class = true and update request. */
    async accept(id, adminUserId) {
        const request = await this.getById(id);
        if (!request) return null;
        if (request.status !== 'pending') {
            throw new Error('Request is not pending');
        }

        await db.query('BEGIN');
        try {
            await db.query(
                'UPDATE courses SET has_live_class = true, updated_at = NOW() WHERE id = $1',
                [request.course_id]
            );
            await db.query(
                `UPDATE live_class_requests SET status = 'accepted', reviewed_at = NOW(), reviewed_by = $1 WHERE id = $2`,
                [adminUserId, id]
            );
            await db.query('COMMIT');
        } catch (e) {
            await db.query('ROLLBACK');
            throw e;
        }
        return this.getById(id);
    }

    /** Decline: update request only. */
    async decline(id, adminUserId) {
        const request = await this.getById(id);
        if (!request) return null;
        if (request.status !== 'pending') {
            throw new Error('Request is not pending');
        }

        await db.query(
            `UPDATE live_class_requests SET status = 'declined', reviewed_at = NOW(), reviewed_by = $1 WHERE id = $2`,
            [adminUserId, id]
        );
        return this.getById(id);
    }
}

module.exports = new LiveClassRequestService();
