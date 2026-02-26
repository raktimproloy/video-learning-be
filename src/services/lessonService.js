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

    async getLessonsByCourse(courseId, userId = null, teacherId = null) {
        const isOwner = userId && teacherId && userId === teacherId;
        const statusFilter = isOwner ? '' : `AND (COALESCE(l.status, 'active') = 'active')`;
        const result = await db.query(
            `SELECT l.*,
                    (SELECT COUNT(*)::int FROM videos v WHERE v.lesson_id = l.id) AS video_count,
                    (SELECT COALESCE(SUM(v.duration_seconds), 0) FROM videos v WHERE v.lesson_id = l.id) AS total_duration_seconds
             FROM lessons l
             WHERE l.course_id = $1 ${statusFilter}
             ORDER BY l."order" ASC, l.created_at ASC`,
            [courseId]
        );
        const lessons = result.rows.map((row) => {
            const lesson = { ...row };
            lesson.notes = lesson.notes ? (typeof lesson.notes === 'string' ? JSON.parse(lesson.notes) : lesson.notes) : [];
            lesson.assignments = lesson.assignments ? (typeof lesson.assignments === 'string' ? JSON.parse(lesson.assignments) : lesson.assignments) : [];
            lesson.notes = Array.isArray(lesson.notes) ? lesson.notes : [];
            lesson.assignments = Array.isArray(lesson.assignments) ? lesson.assignments : [];
            lesson.hasRequiredAssignment = lesson.assignments.some((a) => a && a.isRequired === true);
            lesson.isPreview = lesson.is_preview;
            lesson.videoCount = lesson.video_count ?? 0;
            lesson.duration = (lesson.total_duration_seconds ?? 0) / 60; // minutes for frontend
            return lesson;
        });

        // If userId is provided, check lock status for each lesson
        if (userId) {
            const assignmentService = require('./assignmentService');
            const lessonsWithLockStatus = [];
            for (let i = 0; i < lessons.length; i++) {
                const lesson = lessons[i];
                let isLocked = false;

                // First lesson is never locked
                if (i > 0) {
                    // Check if previous lesson has required assignments that aren't completed
                    const previousLesson = lessons[i - 1];
                    
                    // Check lesson-level required assignments
                    const lessonCompleted = await assignmentService.hasCompletedLessonAssignments(userId, previousLesson.id);
                    if (!lessonCompleted) {
                        isLocked = true;
                    } else {
                        // Check all videos in previous lesson for required assignments
                        const videos = await db.query(
                            'SELECT id FROM videos WHERE lesson_id = $1 ORDER BY "order" ASC',
                            [previousLesson.id]
                        );
                        for (const videoRow of videos.rows) {
                            const videoCompleted = await assignmentService.hasCompletedVideoAssignments(userId, videoRow.id);
                            if (!videoCompleted) {
                                isLocked = true;
                                break;
                            }
                        }
                    }
                }

                lessonsWithLockStatus.push({
                    ...lesson,
                    isLocked
                });
            }
            return lessonsWithLockStatus;
        }

        return lessons;
    }

    /**
     * Check if a lesson can be set as preview. Preview is only allowed when the previous lesson (by order) has no required assignments.
     * @param {string} courseId
     * @param {number} order - Order of the lesson we want to set as preview
     * @param {string|null} excludeLessonId - When editing, exclude this lesson from the "previous" check
     * @returns {{ allowed: boolean, reason?: string }}
     */
    async canSetLessonPreview(courseId, order, excludeLessonId = null) {
        if (order <= 1) return { allowed: true };
        const result = await db.query(
            `SELECT id, assignments FROM lessons WHERE course_id = $1 AND "order" = $2 AND ($3::uuid IS NULL OR id != $3) ORDER BY created_at ASC LIMIT 1`,
            [courseId, order - 1, excludeLessonId]
        );
        const previous = result.rows[0];
        if (!previous) return { allowed: true };
        const assignments = previous.assignments ? (typeof previous.assignments === 'string' ? JSON.parse(previous.assignments) : previous.assignments) : [];
        const hasRequired = Array.isArray(assignments) && assignments.some((a) => a && a.isRequired === true);
        if (hasRequired) {
            return { allowed: false, reason: 'Cannot set as preview: the previous lesson has required assignments. Students must complete them before accessing the next lesson.' };
        }
        return { allowed: true };
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
        if (lessonData.status !== undefined) {
            updates.push(`status = $${paramIndex++}`);
            values.push(lessonData.status);
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

    async updateLiveStatus(id, isLive, sessionData = {}) {
        const { live_session_name, live_session_order, live_session_description, current_live_session_id } = sessionData;
        if (isLive) {
            const result = await db.query(
                `UPDATE lessons SET is_live = true, live_started_at = COALESCE(live_started_at, NOW()),
                 live_session_name = COALESCE($2, live_session_name),
                 live_session_order = COALESCE($3, live_session_order, 0),
                 live_session_description = COALESCE($4, live_session_description),
                 current_live_session_id = COALESCE($5, current_live_session_id)
                 WHERE id = $1 RETURNING *`,
                [id, live_session_name ?? null, live_session_order ?? null, live_session_description ?? null, current_live_session_id ?? null]
            );
            return result.rows[0];
        }
        const result = await db.query(
            `UPDATE lessons SET is_live = false, live_started_at = NULL,
             live_session_name = NULL, live_session_order = NULL, live_session_description = NULL,
             current_live_session_id = NULL
             WHERE id = $1 RETURNING *`,
            [id]
        );
        return result.rows[0];
    }

    async getLiveStartedAt(lessonId) {
        const r = await db.query('SELECT live_started_at FROM lessons WHERE id = $1', [lessonId]);
        return r.rows[0]?.live_started_at || null;
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
             WHERE l.is_live = true AND COALESCE(c.has_live_class, false) = true
             ORDER BY l.updated_at DESC`
        );
        return result.rows;
    }

    /** Live lessons only for courses the student is enrolled in (purchased) and that have live enabled. */
    async getLiveLessonsForStudent(studentId) {
        const result = await db.query(
            `SELECT l.*, c.title as course_title, u.email as teacher_email, c.id as course_id
             FROM lessons l
             JOIN courses c ON l.course_id = c.id
             JOIN users u ON c.teacher_id = u.id
             JOIN course_enrollments ce ON ce.course_id = c.id AND ce.user_id = $1
             WHERE l.is_live = true AND COALESCE(c.has_live_class, false) = true
             ORDER BY l.updated_at DESC`,
            [studentId]
        );
        return result.rows;
    }

    /** Only lessons from courses that have live class enabled. */
    async getTeacherLiveLessons(teacherId) {
        const result = await db.query(
            `SELECT l.*, c.title as course_title, c.id as course_id
             FROM lessons l
             JOIN courses c ON l.course_id = c.id
             WHERE l.is_live = true AND c.teacher_id = $1 AND COALESCE(c.has_live_class, false) = true
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
