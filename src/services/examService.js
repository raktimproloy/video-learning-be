const db = require('../../db');

/** Every mcq gets its own marks; every mcq_n sub-question gets its own marks. */
function computeTotalMarks(questions) {
    if (!Array.isArray(questions)) return 0;
    let total = 0;
    for (const q of questions) {
        if (q.type === 'mcq_n') {
            const subs = Array.isArray(q.subQuestions) ? q.subQuestions : [];
            for (const sq of subs) {
                total += Number(sq.marks) > 0 ? Number(sq.marks) : 1;
            }
        } else {
            total += Number(q.marks) > 0 ? Number(q.marks) : 1;
        }
    }
    return total;
}

const DEFAULT_GRADING_BANDS = [
    { id: 'excellent', minPercent: 80, maxPercent: 100, label: 'Excellent', color: '#16a34a' },
    { id: 'good', minPercent: 60, maxPercent: 79, label: 'Good', color: '#0ea5e9' },
    { id: 'average', minPercent: 40, maxPercent: 59, label: 'Average', color: '#f59e0b' },
    { id: 'poor', minPercent: 0, maxPercent: 39, label: 'Needs Improvement', color: '#ef4444' },
];

class ExamService {
    get defaultGradingBands() {
        return DEFAULT_GRADING_BANDS;
    }

    async listByLesson(lessonId) {
        const result = await db.query(
            `SELECT * FROM exams WHERE lesson_id = $1 ORDER BY created_at ASC`,
            [lessonId]
        );
        return result.rows;
    }

    async listByVideo(videoId) {
        const result = await db.query(
            `SELECT * FROM exams WHERE video_id = $1 ORDER BY created_at ASC`,
            [videoId]
        );
        return result.rows;
    }

    async getById(examId) {
        const result = await db.query(`SELECT * FROM exams WHERE id = $1`, [examId]);
        return result.rows[0] || null;
    }

    async createExam(teacherId, { courseId, lessonId = null, videoId = null, title, description, timeLimitMinutes, questions, gradingBands }) {
        const totalMarks = computeTotalMarks(questions);
        const result = await db.query(
            `INSERT INTO exams (course_id, lesson_id, video_id, teacher_id, title, description, time_limit_minutes, questions, grading_bands, total_marks)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                courseId,
                lessonId,
                videoId,
                teacherId,
                title || 'Untitled Exam',
                description || null,
                Math.max(1, parseInt(timeLimitMinutes, 10) || 30),
                JSON.stringify(questions || []),
                JSON.stringify(gradingBands && gradingBands.length ? gradingBands : DEFAULT_GRADING_BANDS),
                totalMarks,
            ]
        );
        return result.rows[0];
    }

    async updateExam(examId, teacherId, { title, description, timeLimitMinutes, questions, gradingBands }) {
        const existing = await db.query('SELECT status FROM exams WHERE id = $1 AND teacher_id = $2', [examId, teacherId]);
        if (existing.rows[0]?.status === 'published') {
            const err = new Error('Cannot edit a published exam. Unpublish it first.');
            err.status = 403;
            throw err;
        }
        const totalMarks = computeTotalMarks(questions);
        const result = await db.query(
            `UPDATE exams
             SET title = $1, description = $2, time_limit_minutes = $3, questions = $4, grading_bands = $5,
                 total_marks = $6, updated_at = NOW()
             WHERE id = $7 AND teacher_id = $8
             RETURNING *`,
            [
                title || 'Untitled Exam',
                description || null,
                Math.max(1, parseInt(timeLimitMinutes, 10) || 30),
                JSON.stringify(questions || []),
                JSON.stringify(gradingBands && gradingBands.length ? gradingBands : DEFAULT_GRADING_BANDS),
                totalMarks,
                examId,
                teacherId,
            ]
        );
        return result.rows[0] || null;
    }

    async setStatus(examId, teacherId, status) {
        if (!['draft', 'published'].includes(status)) {
            const err = new Error('Invalid exam status');
            err.status = 400;
            throw err;
        }
        if (status === 'published') {
            const exam = await this.getById(examId);
            if (!exam || exam.teacher_id !== teacherId) return null;
            const questions = Array.isArray(exam.questions) ? exam.questions : [];
            if (questions.length === 0) {
                const err = new Error('Add at least one question before publishing.');
                err.status = 400;
                throw err;
            }
            for (const q of questions) {
                if (q.type === 'mcq_n') {
                    const subs = Array.isArray(q.subQuestions) ? q.subQuestions : [];
                    if (subs.length === 0 || subs.some((sq) => !sq.correctOptionId)) {
                        const err = new Error('Every passage sub-question needs a correct answer selected.');
                        err.status = 400;
                        throw err;
                    }
                } else if (!q.correctOptionId) {
                    const err = new Error('Every question needs a correct answer selected.');
                    err.status = 400;
                    throw err;
                }
            }
        }
        const result = await db.query(
            `UPDATE exams SET status = $1, updated_at = NOW() WHERE id = $2 AND teacher_id = $3 RETURNING *`,
            [status, examId, teacherId]
        );
        return result.rows[0] || null;
    }

    async deleteExam(examId, teacherId) {
        const result = await db.query(`DELETE FROM exams WHERE id = $1 AND teacher_id = $2 RETURNING id`, [examId, teacherId]);
        return result.rowCount > 0;
    }
}

module.exports = new ExamService();
