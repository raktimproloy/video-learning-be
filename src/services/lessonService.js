const db = require('../../db');

class LessonService {
    async createLesson(courseId, title, description, order) {
        const result = await db.query(
            'INSERT INTO lessons (course_id, title, description, "order") VALUES ($1, $2, $3, $4) RETURNING *',
            [courseId, title, description, order || 0]
        );
        return result.rows[0];
    }

    async getLessonsByCourse(courseId) {
        const result = await db.query(
            'SELECT * FROM lessons WHERE course_id = $1 ORDER BY "order" ASC, created_at ASC',
            [courseId]
        );
        return result.rows;
    }

    async getLessonById(id) {
        const result = await db.query('SELECT * FROM lessons WHERE id = $1', [id]);
        return result.rows[0];
    }

    async updateLesson(id, title, description, order) {
        const result = await db.query(
            'UPDATE lessons SET title = $1, description = $2, "order" = $3 WHERE id = $4 RETURNING *',
            [title, description, order, id]
        );
        return result.rows[0];
    }

    async deleteLesson(id) {
        await db.query('DELETE FROM lessons WHERE id = $1', [id]);
    }
}

module.exports = new LessonService();
