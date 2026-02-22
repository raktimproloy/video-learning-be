const db = require('../../db');
const { randomUUID } = require('crypto');

class LiveSessionService {
    /**
     * Create a new live session when teacher starts live.
     * Returns the session (id will become video_id when saved).
     * broadcast_status starts as 'starting' (teacher testing setup, students see "Live Starting Soon").
     */
    async create(lessonId, courseId, ownerId, { liveName, liveOrder, liveDescription }) {
        const id = randomUUID();
        const result = await db.query(
            `INSERT INTO live_sessions (id, lesson_id, course_id, owner_id, live_name, live_order, live_description, status, broadcast_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 'starting')
             RETURNING *`,
            [id, lessonId, courseId, ownerId, liveName ?? null, liveOrder ?? 0, liveDescription ?? null]
        );
        return result.rows[0];
    }

    /**
     * Update live session name and description (teacher only, active session).
     */
    async updateSession(lessonId, { liveName, liveDescription }) {
        const session = await this.getActiveByLesson(lessonId);
        if (!session) return null;
        const updates = [];
        const values = [];
        let i = 1;
        if (liveName !== undefined) {
            updates.push(`live_name = $${i++}`);
            values.push(liveName && String(liveName).trim() ? String(liveName).trim() : null);
        }
        if (liveDescription !== undefined) {
            updates.push(`live_description = $${i++}`);
            values.push(liveDescription && String(liveDescription).trim() ? String(liveDescription).trim() : null);
        }
        if (updates.length === 0) return session;
        values.push(session.id);
        await db.query(
            `UPDATE live_sessions SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i}`,
            values
        );
        return this.getById(session.id);
    }

    /**
     * Update broadcast status for active session: 'starting' | 'live' | 'paused' | 'ended'
     */
    async setBroadcastStatus(lessonId, broadcastStatus) {
        const session = await this.getActiveByLesson(lessonId);
        if (!session) return null;
        await db.query(
            `UPDATE live_sessions SET broadcast_status = $1, updated_at = NOW()
             WHERE id = $2 AND status = 'active'`,
            [broadcastStatus, session.id]
        );
        return { ...session, broadcast_status: broadcastStatus };
    }

    /**
     * Get active live session for a lesson.
     */
    async getActiveByLesson(lessonId) {
        const result = await db.query(
            `SELECT * FROM live_sessions
             WHERE lesson_id = $1 AND status = 'active'
             ORDER BY started_at DESC LIMIT 1`,
            [lessonId]
        );
        return result.rows[0] || null;
    }

    /**
     * Get live session by id.
     */
    async getById(id) {
        const result = await db.query('SELECT * FROM live_sessions WHERE id = $1', [id]);
        return result.rows[0] || null;
    }

    /**
     * Link lesson to current live session.
     */
    async setLessonCurrentSession(lessonId, liveSessionId) {
        await db.query(
            'UPDATE lessons SET current_live_session_id = $1 WHERE id = $2',
            [liveSessionId, lessonId]
        );
    }

    /**
     * End live session: set broadcast_status to 'ended', then clear lesson link, mark as discarded (no save).
     * Only updates sessions that are still 'active' (saved sessions are left as-is).
     */
    async endDiscarded(lessonId) {
        const session = await this.getActiveByLesson(lessonId);
        if (session && session.status === 'active') {
            await db.query(
                `UPDATE live_sessions SET broadcast_status = 'ended', status = 'discarded', ended_at = NOW(), updated_at = NOW()
                 WHERE id = $1 AND status = 'active'`,
                [session.id]
            );
        }
        await db.query(
            'UPDATE lessons SET current_live_session_id = NULL WHERE id = $1',
            [lessonId]
        );
    }

    /**
     * Mark live session as saved (after video created with same id).
     */
    async markSaved(liveSessionId) {
        await db.query(
            `UPDATE live_sessions SET status = 'saved', ended_at = COALESCE(ended_at, NOW()), updated_at = NOW()
             WHERE id = $1`,
            [liveSessionId]
        );
    }

    /**
     * Clear lesson's current live session link (e.g. when ending live).
     */
    async clearLessonSession(lessonId) {
        await db.query(
            'UPDATE lessons SET current_live_session_id = NULL WHERE id = $1',
            [lessonId]
        );
    }
}

module.exports = new LiveSessionService();
