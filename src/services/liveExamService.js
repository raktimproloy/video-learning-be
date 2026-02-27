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
  async listByLesson(lessonId, { onlyPublished = false, liveSessionId = null, includeUnbound = false } = {}) {
    const whereParts = ['lesson_id = $1'];
    const params = [lessonId];
    if (liveSessionId) {
      if (includeUnbound) {
        whereParts.push('(live_session_id = $2 OR live_session_id IS NULL)');
      } else {
        whereParts.push('live_session_id = $2');
      }
      params.push(liveSessionId);
    }
    if (onlyPublished) {
      whereParts.push("status = 'published'");
    }
    const result = await db.query(
      `SELECT id, lesson_id, live_session_id, title, time_limit_minutes, questions, status, created_by, created_at,
              published_at, visibility_countdown_seconds
       FROM live_exams
       WHERE ${whereParts.join(' AND ')}
       ORDER BY created_at ASC`,
      params,
    );
    return result.rows;
  }

  async create(lessonId, teacherId, { title, timeLimitMinutes, questions, liveSessionId = null }) {
    const result = await db.query(
      `INSERT INTO live_exams (lesson_id, live_session_id, title, time_limit_minutes, questions, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6)
       RETURNING *`,
      [lessonId, liveSessionId, title || null, timeLimitMinutes ?? null, JSON.stringify(questions || []), teacherId],
    );
    return result.rows[0] || null;
  }

  async update(lessonId, examId, teacherId, { title, timeLimitMinutes, questions }) {
    const existing = await db.query(
      'SELECT status FROM live_exams WHERE id = $1 AND lesson_id = $2 AND created_by = $3',
      [examId, lessonId, teacherId],
    );
    if (existing.rows[0]?.status === 'published') {
      throw new Error('Cannot edit published exam');
    }
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
           updated_at = NOW(),
           published_at = CASE WHEN $1 = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END
       WHERE id = $2 AND lesson_id = $3 AND created_by = $4
       RETURNING *`,
      [status, examId, lessonId, teacherId],
    );
    return result.rows[0] || null;
  }
}

module.exports = new LiveExamService();

