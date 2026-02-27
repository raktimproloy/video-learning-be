const db = require('../../db');

/**
 * Service for live exams (MCQ) attached to a lesson/live session.
 *
 * NOTE: This assumes a table `live_exams` with at least:
 *  - id UUID primary key
 *  - lesson_id UUID
 *  - live_session_id UUID NULL
 *  - title TEXT
 *  - time_limit_minutes INT NULL
 *  - questions JSONB (array of questions/options/correct answer)
 *  - status TEXT CHECK (status IN ('draft','published')) DEFAULT 'draft'
 *  - created_by UUID
 *  - created_at TIMESTAMPTZ DEFAULT now()
 */
class LiveExamService {
  async listByLesson(lessonId, { onlyPublished = false } = {}) {
    const whereParts = ['lesson_id = $1'];
    const params = [lessonId];
    if (onlyPublished) {
      whereParts.push("status = 'published'");
    }
    const result = await db.query(
      `SELECT id, lesson_id, live_session_id, title, time_limit_minutes, questions, status, created_by, created_at
       FROM live_exams
       WHERE ${whereParts.join(' AND ')}
       ORDER BY created_at ASC`,
      params,
    );
    return result.rows;
  }

  async create(lessonId, teacherId, { title, timeLimitMinutes, questions }) {
    const result = await db.query(
      `INSERT INTO live_exams (lesson_id, title, time_limit_minutes, questions, status, created_by)
       VALUES ($1, $2, $3, $4, 'draft', $5)
       RETURNING *`,
      [lessonId, title || null, timeLimitMinutes ?? null, JSON.stringify(questions || []), teacherId],
    );
    return result.rows[0] || null;
  }

  async update(lessonId, examId, teacherId, { title, timeLimitMinutes, questions }) {
    const result = await db.query(
      `UPDATE live_exams
       SET title = $1,
           time_limit_minutes = $2,
           questions = $3,
           updated_at = NOW()
       WHERE id = $4 AND lesson_id = $5 AND created_by = $6
       RETURNING *`,
      [title || null, timeLimitMinutes ?? null, JSON.stringify(questions || []), examId, lessonId, teacherId],
    );
    return result.rows[0] || null;
  }

  async setStatus(lessonId, examId, teacherId, status) {
    const allowed = ['draft', 'published'];
    if (!allowed.includes(status)) {
      throw new Error('Invalid exam status');
    }
    const result = await db.query(
      `UPDATE live_exams
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2 AND lesson_id = $3 AND created_by = $4
       RETURNING *`,
      [status, examId, lessonId, teacherId],
    );
    return result.rows[0] || null;
  }
}

module.exports = new LiveExamService();

