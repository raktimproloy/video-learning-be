const db = require('../../db');

class RecordingDraftService {
    async listByTeacher(teacherId) {
        const result = await db.query(
            `SELECT rd.*,
                    c.title AS course_title,
                    l.title AS lesson_title
             FROM recording_drafts rd
             LEFT JOIN courses c ON c.id = rd.course_id
             LEFT JOIN lessons l ON l.id = rd.lesson_id
             WHERE rd.teacher_id = $1
             ORDER BY rd.created_at DESC`,
            [teacherId]
        );
        return result.rows;
    }

    async getById(id, teacherId) {
        const result = await db.query(
            `SELECT rd.*,
                    c.title AS course_title,
                    l.title AS lesson_title
             FROM recording_drafts rd
             LEFT JOIN courses c ON c.id = rd.course_id
             LEFT JOIN lessons l ON l.id = rd.lesson_id
             WHERE rd.id = $1 AND rd.teacher_id = $2
             LIMIT 1`,
            [id, teacherId]
        );
        return result.rows[0] || null;
    }

    async create(payload) {
        const {
            teacherId,
            title,
            description,
            courseId,
            lessonId,
            sourceObjectKey,
            sourcePrefix,
            mimeType,
            sizeBytes,
            durationSeconds,
        } = payload;

        const result = await db.query(
            `INSERT INTO recording_drafts
             (teacher_id, title, description, course_id, lesson_id, source_object_key, source_prefix, mime_type, size_bytes, duration_seconds)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING *`,
            [
                teacherId,
                title,
                description || null,
                courseId || null,
                lessonId || null,
                sourceObjectKey,
                sourcePrefix,
                mimeType || null,
                sizeBytes ?? null,
                durationSeconds ?? null,
            ]
        );
        return result.rows[0];
    }

    async update(id, teacherId, patch) {
        const updates = [];
        const values = [];
        let idx = 1;

        const assign = (col, val) => {
            updates.push(`${col} = $${idx++}`);
            values.push(val);
        };

        if (patch.title !== undefined) assign('title', patch.title);
        if (patch.description !== undefined) assign('description', patch.description || null);
        if (patch.courseId !== undefined) assign('course_id', patch.courseId || null);
        if (patch.lessonId !== undefined) assign('lesson_id', patch.lessonId || null);
        if (patch.trimStartSeconds !== undefined) assign('trim_start_seconds', patch.trimStartSeconds ?? null);
        if (patch.trimEndSeconds !== undefined) assign('trim_end_seconds', patch.trimEndSeconds ?? null);
        if (patch.status !== undefined) assign('status', patch.status);
        if (patch.publishedVideoId !== undefined) assign('published_video_id', patch.publishedVideoId || null);
        if (patch.sourceObjectKey !== undefined) assign('source_object_key', patch.sourceObjectKey);
        if (patch.sourcePrefix !== undefined) assign('source_prefix', patch.sourcePrefix);
        if (patch.sizeBytes !== undefined) assign('size_bytes', patch.sizeBytes ?? null);
        if (patch.durationSeconds !== undefined) assign('duration_seconds', patch.durationSeconds ?? null);

        updates.push(`updated_at = NOW()`);
        values.push(id, teacherId);

        const result = await db.query(
            `UPDATE recording_drafts
             SET ${updates.join(', ')}
             WHERE id = $${idx++} AND teacher_id = $${idx}
             RETURNING *`,
            values
        );
        return result.rows[0] || null;
    }
}

module.exports = new RecordingDraftService();

