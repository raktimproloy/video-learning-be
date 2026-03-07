const db = require('../../db');
const { randomUUID } = require('crypto');
const liveUsageService = require('./liveUsageService');

class LiveSessionService {
    /**
     * Create a new live session when teacher starts live.
     * Returns the session (id will become video_id when saved).
     * broadcast_status starts as 'starting'. provider: 'agora' | '100ms' | 'aws_ivs' | 'youtube'.
     */
    async create(lessonId, courseId, ownerId, { liveName, liveOrder, liveDescription, provider = 'agora' }) {
        const id = randomUUID();
        const prov = liveUsageService.PROVIDERS.includes(provider) ? provider : 'agora';
        const result = await db.query(
            `INSERT INTO live_sessions (id, lesson_id, course_id, owner_id, live_name, live_order, live_description, status, broadcast_status, provider)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 'starting', $8)
             RETURNING *`,
            [id, lessonId, courseId, ownerId, liveName ?? null, liveOrder ?? 0, liveDescription ?? null, prov]
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
     * Records usage (minutes) for this session so free-minute counters stay accurate.
     * Also sets lesson.is_live = false so student dashboard and course content stop showing "live".
     */
    async endDiscarded(lessonId) {
        const session = await this.getActiveByLesson(lessonId);
        if (session && session.status === 'active') {
            await db.query(
                `UPDATE live_sessions SET broadcast_status = 'ended', status = 'discarded', ended_at = NOW(), updated_at = NOW()
                 WHERE id = $1 AND status = 'active'`,
                [session.id]
            );
            try {
                await liveUsageService.recordUsageForSession(session.id);
            } catch (err) {
                console.error('Live usage record (endDiscarded) failed:', err);
            }
        }
        await db.query(
            `UPDATE lessons SET current_live_session_id = NULL,
             is_live = false, live_started_at = NULL,
             live_session_name = NULL, live_session_order = NULL, live_session_description = NULL
             WHERE id = $1`,
            [lessonId]
        );
    }

    /**
     * Mark live session as saved (after video created with same id).
     * Records usage (minutes) for this session.
     */
    async markSaved(liveSessionId) {
        await db.query(
            `UPDATE live_sessions SET status = 'saved', ended_at = COALESCE(ended_at, NOW()), updated_at = NOW()
             WHERE id = $1`,
            [liveSessionId]
        );
        try {
            await liveUsageService.recordUsageForSession(liveSessionId);
        } catch (err) {
            console.error('Live usage record (markSaved) failed:', err);
        }
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

    /**
     * Mark the active session as limit-reached (teacher hit time limit). Used so backend can force-end after grace.
     * Idempotent: safe to call multiple times.
     */
    async setLimitReachedAt(lessonId) {
        const session = await this.getActiveByLesson(lessonId);
        if (!session) return null;
        await db.query(
            `UPDATE live_sessions SET limit_reached_at = COALESCE(limit_reached_at, NOW()), updated_at = NOW()
             WHERE id = $1 AND status = 'active'`,
            [session.id]
        );
        return session;
    }

    /**
     * List all active live sessions with course, lesson, and owner info (for admin).
     */
    async listActiveForAdmin() {
        const result = await db.query(
            `SELECT ls.id, ls.lesson_id, ls.course_id, ls.owner_id, ls.live_name, ls.live_description,
                    ls.started_at, ls.broadcast_status, ls.provider, ls.status,
                    c.title AS course_title,
                    l.title AS lesson_title, l.order AS lesson_order,
                    u.email AS owner_email,
                    COALESCE(tp.name, u.email) AS owner_name,
                    (SELECT COUNT(*)::int FROM live_watch_records lwr WHERE lwr.live_session_id = ls.id AND lwr.left_at IS NULL) AS viewer_count_now,
                    (SELECT COUNT(DISTINCT lwr.student_id)::int FROM live_watch_records lwr WHERE lwr.live_session_id = ls.id) AS viewer_count_total,
                    (SELECT COUNT(*)::int FROM live_chat_messages lcm WHERE lcm.live_session_id = ls.id) AS chat_message_count,
                    (SELECT COALESCE(SUM(lwr.watch_seconds), 0)::bigint FROM live_watch_records lwr WHERE lwr.live_session_id = ls.id) AS total_watch_seconds
             FROM live_sessions ls
             JOIN courses c ON c.id = ls.course_id
             JOIN lessons l ON l.id = ls.lesson_id
             JOIN users u ON u.id = ls.owner_id
             LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
             WHERE ls.status = 'active'
             ORDER BY ls.started_at DESC`
        );
        return result.rows;
    }

    /**
     * Find active sessions where limit was reached at least graceMinutes ago and force-end them.
     * Records usage (minutes) via endDiscarded so provider usage is always saved.
     * @param {number} graceMinutes - minutes after limit_reached_at before force-ending (e.g. 5)
     * @returns {Promise<Array<{ lessonId: string }>>} list of lesson IDs that were force-ended
     */
    async forceEndExpiredLimitSessions(graceMinutes = 5) {
        const graceSeconds = Math.max(0, Number(graceMinutes) || 5) * 60;
        const result = await db.query(
            `SELECT id, lesson_id FROM live_sessions
             WHERE status = 'active' AND limit_reached_at IS NOT NULL
             AND (EXTRACT(EPOCH FROM (NOW() - limit_reached_at)) >= $1)
             ORDER BY limit_reached_at ASC`,
            [graceSeconds]
        );
        const ended = [];
        for (const row of result.rows) {
            try {
                await this.endDiscarded(row.lesson_id);
                ended.push({ lessonId: row.lesson_id });
            } catch (err) {
                console.error('forceEndExpiredLimitSessions: endDiscarded failed for lesson', row.lesson_id, err);
            }
        }
        return ended;
    }
}

module.exports = new LiveSessionService();
