const db = require('../../db');

class LiveMaterialService {
    async list(lessonId) {
        const result = await db.query(
            `SELECT id, lesson_id, type, content, file_path, file_name, is_required, created_by, created_at
             FROM live_materials
             WHERE lesson_id = $1
             ORDER BY created_at ASC`,
            [lessonId]
        );
        return result.rows;
    }

    async addNote(lessonId, teacherId, { content, filePath, fileName }) {
        const result = await db.query(
            `INSERT INTO live_materials (lesson_id, type, content, file_path, file_name, created_by)
             VALUES ($1, 'note', $2, $3, $4, $5)
             RETURNING *`,
            [lessonId, content || null, filePath || null, fileName || null, teacherId]
        );
        return result.rows[0] || null;
    }

    async addAssignment(lessonId, teacherId, { content, filePath, fileName, isRequired }) {
        const result = await db.query(
            `INSERT INTO live_materials (lesson_id, type, content, file_path, file_name, is_required, created_by)
             VALUES ($1, 'assignment', $2, $3, $4, $5, $6)
             RETURNING *`,
            [lessonId, content || null, filePath || null, fileName || null, !!isRequired, teacherId]
        );
        return result.rows[0] || null;
    }
}

module.exports = new LiveMaterialService();
