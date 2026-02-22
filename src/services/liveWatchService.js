const db = require('../../db');

class LiveWatchService {
    async join(lessonId, studentId, liveSessionId = null) {
        await db.query(
            `UPDATE live_watch_records SET left_at = NOW(),
             watch_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - joined_at))::INTEGER)
             WHERE lesson_id = $1 AND student_id = $2 AND left_at IS NULL`,
            [lessonId, studentId]
        );
        const result = await db.query(
            `INSERT INTO live_watch_records (lesson_id, student_id, joined_at, watch_seconds, live_session_id)
             VALUES ($1, $2, NOW(), 0, $3)
             RETURNING *`,
            [lessonId, studentId, liveSessionId]
        );
        return result.rows[0];
    }

    async leave(lessonId, studentId) {
        const r = await db.query(
            `UPDATE live_watch_records
             SET left_at = NOW(),
                 watch_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - joined_at))::INTEGER)
             WHERE lesson_id = $1 AND student_id = $2 AND left_at IS NULL
             RETURNING *`,
            [lessonId, studentId]
        );
        return r.rows[0];
    }

    async heartbeat(lessonId, studentId) {
        const r = await db.query(
            `UPDATE live_watch_records
             SET watch_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - joined_at))::INTEGER)
             WHERE lesson_id = $1 AND student_id = $2 AND left_at IS NULL
             RETURNING *`,
            [lessonId, studentId]
        );
        return r.rows[0];
    }

    /**
     * Get viewer count for a lesson. Excludes the course owner (teacher) - only counts students.
     * @param {string} lessonId
     * @param {string} [excludeTeacherId] - course owner id to exclude from count
     */
    async getViewerCount(lessonId, excludeTeacherId = null) {
        const args = excludeTeacherId ? [lessonId, excludeTeacherId] : [lessonId];
        const cond = excludeTeacherId
            ? 'WHERE lesson_id = $1 AND left_at IS NULL AND student_id != $2'
            : 'WHERE lesson_id = $1 AND left_at IS NULL';
        const r = await db.query(
            `SELECT COUNT(*)::int as count FROM live_watch_records ${cond}`,
            args
        );
        return r.rows[0]?.count ?? 0;
    }

    /** Total watch seconds per student for a lesson (across all sessions) */
    async getWatchTimeByStudent(lessonId) {
        const r = await db.query(
            `SELECT student_id, SUM(watch_seconds)::int as total_seconds
             FROM live_watch_records WHERE lesson_id = $1 GROUP BY student_id`,
            [lessonId]
        );
        return r.rows;
    }

    /** Count distinct students who attended a specific live session (for setting initial view_count when saving). */
    async getAttendeeCountBySession(liveSessionId) {
        const r = await db.query(
            `SELECT COUNT(DISTINCT student_id)::int as count
             FROM live_watch_records
             WHERE live_session_id = $1`,
            [liveSessionId]
        );
        return r.rows[0]?.count ?? 0;
    }

    /** Which students watched this live */
    async getWatchers(lessonId) {
        const r = await db.query(
            `SELECT lwr.student_id, u.email,
                    SUM(lwr.watch_seconds)::int as total_watch_seconds,
                    MIN(lwr.joined_at) as first_joined,
                    MAX(COALESCE(lwr.left_at, lwr.joined_at)) as last_seen
             FROM live_watch_records lwr
             JOIN users u ON u.id = lwr.student_id
             WHERE lwr.lesson_id = $1
             GROUP BY lwr.student_id, u.email`,
            [lessonId]
        );
        return r.rows;
    }
}

module.exports = new LiveWatchService();
