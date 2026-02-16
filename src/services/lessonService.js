const db = require('../../db');

class LessonService {
    async createLesson(courseId, lessonData) {
        const {
            title,
            description,
            order,
            isPreview,
            notes,
            assignments
        } = lessonData;

        const result = await db.query(
            `INSERT INTO lessons (course_id, title, description, "order", is_preview, notes, assignments)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [
                courseId,
                title || '',
                description || '',
                order ?? 0,
                isPreview ?? false,
                JSON.stringify(notes || []),
                JSON.stringify(assignments || [])
            ]
        );
        return result.rows[0];
    }

    async getLessonsByCourse(courseId) {
        const result = await db.query(
            'SELECT * FROM lessons WHERE course_id = $1 ORDER BY "order" ASC, created_at ASC',
            [courseId]
        );
        return result.rows.map((row) => {
            const lesson = { ...row };
            if (lesson.notes) lesson.notes = typeof lesson.notes === 'string' ? JSON.parse(lesson.notes) : lesson.notes;
            if (lesson.assignments) lesson.assignments = typeof lesson.assignments === 'string' ? JSON.parse(lesson.assignments) : lesson.assignments;
            lesson.isPreview = lesson.is_preview;
            return lesson;
        });
    }

    async getLessonById(id) {
        const result = await db.query('SELECT * FROM lessons WHERE id = $1', [id]);
        const lesson = result.rows[0];
        if (lesson) {
            if (lesson.notes) lesson.notes = typeof lesson.notes === 'string' ? JSON.parse(lesson.notes) : lesson.notes;
            if (lesson.assignments) lesson.assignments = typeof lesson.assignments === 'string' ? JSON.parse(lesson.assignments) : lesson.assignments;
            lesson.isPreview = lesson.is_preview;
        }
        return lesson;
    }

    async updateLesson(id, lessonData) {
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (lessonData.title !== undefined) {
            updates.push(`title = $${paramIndex++}`);
            values.push(lessonData.title);
        }
        if (lessonData.description !== undefined) {
            updates.push(`description = $${paramIndex++}`);
            values.push(lessonData.description);
        }
        if (lessonData.order !== undefined) {
            updates.push(`"order" = $${paramIndex++}`);
            values.push(lessonData.order);
        }
        if (lessonData.isPreview !== undefined) {
            updates.push(`is_preview = $${paramIndex++}`);
            values.push(lessonData.isPreview);
        }
        if (lessonData.notes !== undefined) {
            updates.push(`notes = $${paramIndex++}`);
            values.push(JSON.stringify(lessonData.notes));
        }
        if (lessonData.assignments !== undefined) {
            updates.push(`assignments = $${paramIndex++}`);
            values.push(JSON.stringify(lessonData.assignments));
        }

        if (updates.length === 0) return this.getLessonById(id);

        updates.push('updated_at = NOW()');
        values.push(id);

        const result = await db.query(
            `UPDATE lessons SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
            values
        );
        const lesson = result.rows[0];
        if (lesson) {
            if (lesson.notes) lesson.notes = typeof lesson.notes === 'string' ? JSON.parse(lesson.notes) : lesson.notes;
            if (lesson.assignments) lesson.assignments = typeof lesson.assignments === 'string' ? JSON.parse(lesson.assignments) : lesson.assignments;
            lesson.isPreview = lesson.is_preview;
        }
        return lesson;
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
