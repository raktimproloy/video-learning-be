const db = require('../../db');

class CourseService {
    async createCourse(teacherId, title, description) {
        const result = await db.query(
            'INSERT INTO courses (teacher_id, title, description) VALUES ($1, $2, $3) RETURNING *',
            [teacherId, title, description]
        );
        return result.rows[0];
    }

    async getCoursesByTeacher(teacherId) {
        const result = await db.query(
            'SELECT * FROM courses WHERE teacher_id = $1 ORDER BY created_at DESC',
            [teacherId]
        );
        return result.rows;
    }

    async getAllCourses() {
        const result = await db.query(
            'SELECT courses.*, users.email as teacher_email FROM courses LEFT JOIN users ON courses.teacher_id = users.id ORDER BY courses.created_at DESC'
        );
        return result.rows;
    }

    async getCourseById(id) {
        const result = await db.query('SELECT * FROM courses WHERE id = $1', [id]);
        return result.rows[0];
    }

    async updateCourse(id, title, description) {
        const result = await db.query(
            'UPDATE courses SET title = $1, description = $2 WHERE id = $3 RETURNING *',
            [title, description, id]
        );
        return result.rows[0];
    }

    async deleteCourse(id) {
        await db.query('DELETE FROM courses WHERE id = $1', [id]);
    }

    async enrollUser(userId, courseId) {
        const result = await db.query(
            'INSERT INTO course_enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
            [userId, courseId]
        );
        return result.rows[0];
    }

    async getPurchasedCourses(userId) {
        const result = await db.query(
            `SELECT c.*, u.email as teacher_email 
             FROM courses c
             JOIN course_enrollments ce ON c.id = ce.course_id
             LEFT JOIN users u ON c.teacher_id = u.id
             WHERE ce.user_id = $1
             ORDER BY ce.enrolled_at DESC`,
            [userId]
        );
        return result.rows;
    }

    async getUnpurchasedCourses(userId) {
        const result = await db.query(
            `SELECT c.*, u.email as teacher_email 
             FROM courses c
             LEFT JOIN users u ON c.teacher_id = u.id
             WHERE c.id NOT IN (
                 SELECT course_id FROM course_enrollments WHERE user_id = $1
             )
             ORDER BY c.created_at DESC`,
            [userId]
        );
        return result.rows;
    }

    async isEnrolled(userId, courseId) {
        const result = await db.query(
            'SELECT 1 FROM course_enrollments WHERE user_id = $1 AND course_id = $2',
            [userId, courseId]
        );
        return result.rowCount > 0;
    }
}

module.exports = new CourseService();
