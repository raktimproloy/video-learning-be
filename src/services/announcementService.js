const db = require('../../db');

class AnnouncementService {
    /**
     * Create an announcement for a course. Teacher must own the course.
     */
    async create(teacherId, { courseId, title, body }) {
        const result = await db.query(
            `INSERT INTO course_announcements (course_id, teacher_id, title, body)
             SELECT $1, $2, $3, $4
             FROM courses c
             WHERE c.id = $1 AND c.teacher_id = $2
             RETURNING *`,
            [courseId, teacherId, title, body || '']
        );
        if (!result.rows[0]) {
            const courseCheck = await db.query('SELECT id FROM courses WHERE id = $1', [courseId]);
            if (!courseCheck.rows[0]) throw new Error('Course not found');
            throw new Error('You can only create announcements for your own courses');
        }
        return result.rows[0];
    }

    /**
     * List announcements created by the teacher (for teacher dashboard).
     */
    async getByTeacher(teacherId, limit = 50, offset = 0) {
        const result = await db.query(
            `SELECT a.id, a.course_id, a.teacher_id, a.title, a.body, a.created_at,
                    c.title as course_title
             FROM course_announcements a
             JOIN courses c ON c.id = a.course_id AND c.teacher_id = $1
             WHERE a.teacher_id = $1
             ORDER BY a.created_at DESC
             LIMIT $2 OFFSET $3`,
            [teacherId, limit, offset]
        );
        return result.rows;
    }

    /**
     * List announcements for a student: only for courses they are enrolled in.
     * Includes read status. Ordered by created_at DESC.
     */
    async getForStudent(userId, limit = 30, offset = 0) {
        const result = await db.query(
            `SELECT a.id, a.course_id, a.teacher_id, a.title, a.body, a.created_at,
                    c.title as course_title,
                    (ar.read_at IS NOT NULL) as read
             FROM course_announcements a
             JOIN courses c ON c.id = a.course_id
             JOIN course_enrollments ce ON ce.course_id = a.course_id AND ce.user_id = $1
             LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = $1
             ORDER BY a.created_at DESC
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );
        return result.rows.map(row => ({
            id: row.id,
            course_id: row.course_id,
            course_title: row.course_title,
            teacher_id: row.teacher_id,
            title: row.title,
            body: row.body,
            created_at: row.created_at,
            read: !!row.read,
        }));
    }

    /**
     * Count unread announcements for a student (for navbar badge).
     */
    async getUnreadCount(userId) {
        const result = await db.query(
            `SELECT COUNT(a.id)::int as count
             FROM course_announcements a
             JOIN course_enrollments ce ON ce.course_id = a.course_id AND ce.user_id = $1
             LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = $1
             WHERE ar.read_at IS NULL`,
            [userId]
        );
        return result.rows[0]?.count || 0;
    }

    /**
     * Mark an announcement as read for a user. Only allowed if user is enrolled in the course.
     */
    async markAsRead(userId, announcementId) {
        const allowed = await db.query(
            `SELECT 1 FROM course_announcements a
             JOIN course_enrollments ce ON ce.course_id = a.course_id AND ce.user_id = $1
             WHERE a.id = $2`,
            [userId, announcementId]
        );
        if (!allowed.rows[0]) return false;
        await db.query(
            `INSERT INTO announcement_reads (user_id, announcement_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, announcement_id) DO NOTHING`,
            [userId, announcementId]
        );
        return true;
    }
}

module.exports = new AnnouncementService();
