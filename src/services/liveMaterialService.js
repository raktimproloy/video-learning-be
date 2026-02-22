const db = require('../../db');

class LiveMaterialService {
    async list(lessonId, liveSessionId = null) {
        const whereClause = liveSessionId
            ? 'WHERE lesson_id = $1 AND live_session_id = $2'
            : 'WHERE lesson_id = $1';
        const params = liveSessionId ? [lessonId, liveSessionId] : [lessonId];
        const result = await db.query(
            `SELECT id, lesson_id, type, content, file_path, file_name, is_required, created_by, created_at
             FROM live_materials
             ${whereClause}
             ORDER BY created_at ASC`,
            params
        );
        return result.rows;
    }

    async addNote(lessonId, teacherId, { content, filePath, fileName }, liveSessionId = null) {
        const result = await db.query(
            `INSERT INTO live_materials (lesson_id, type, content, file_path, file_name, created_by, live_session_id)
             VALUES ($1, 'note', $2, $3, $4, $5, $6)
             RETURNING *`,
            [lessonId, content || null, filePath || null, fileName || null, teacherId, liveSessionId]
        );
        return result.rows[0] || null;
    }

    async addAssignment(lessonId, teacherId, { content, filePath, fileName, isRequired }, liveSessionId = null) {
        const result = await db.query(
            `INSERT INTO live_materials (lesson_id, type, content, file_path, file_name, is_required, created_by, live_session_id)
             VALUES ($1, 'assignment', $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [lessonId, content || null, filePath || null, fileName || null, !!isRequired, teacherId, liveSessionId]
        );
        return result.rows[0] || null;
    }

    /** List materials for a specific live session (for copying to video when saved). */
    async listBySession(liveSessionId) {
        const result = await db.query(
            `SELECT id, type, content, file_path, file_name, is_required
             FROM live_materials
             WHERE live_session_id = $1
             ORDER BY created_at ASC`,
            [liveSessionId]
        );
        return result.rows;
    }
}

module.exports = new LiveMaterialService();
