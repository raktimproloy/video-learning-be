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

    async updateLiveStatus(id, isLive) {
        const result = await db.query(
            'UPDATE lessons SET is_live = $1 WHERE id = $2 RETURNING *',
            [isLive, id]
        );
        return result.rows[0];
    }

    async updateLessonVod(id, vodUrl) {
        const query = 'UPDATE lessons SET video_url = $1 WHERE id = $2 RETURNING *';
        const { rows } = await db.query(query, [vodUrl, id]);
        return rows[0];
    }

    async getLiveLessons() {
        const result = await db.query(
            `SELECT l.*, c.title as course_title, u.email as teacher_email 
             FROM lessons l
             JOIN courses c ON l.course_id = c.id
             JOIN users u ON c.teacher_id = u.id
             WHERE l.is_live = true 
             ORDER BY l.updated_at DESC`
        );
        return result.rows;
    }

    /** Live lessons only for courses the student is enrolled in (purchased). */
    async getLiveLessonsForStudent(studentId) {
        const result = await db.query(
            `SELECT l.*, c.title as course_title, u.email as teacher_email, c.id as course_id
             FROM lessons l
             JOIN courses c ON l.course_id = c.id
             JOIN users u ON c.teacher_id = u.id
             JOIN course_enrollments ce ON ce.course_id = c.id AND ce.user_id = $1
             WHERE l.is_live = true 
             ORDER BY l.updated_at DESC`,
            [studentId]
        );
        return result.rows;
    }

    async getTeacherLiveLessons(teacherId) {
        const result = await db.query(
            `SELECT l.*, c.title as course_title, c.id as course_id
             FROM lessons l
             JOIN courses c ON l.course_id = c.id
             WHERE l.is_live = true AND c.teacher_id = $1
             ORDER BY l.updated_at DESC`,
            [teacherId]
        );
        return result.rows;
    }

    async deleteLesson(id) {
        await db.query('DELETE FROM lessons WHERE id = $1', [id]);
    }
}

module.exports = new LessonService();
