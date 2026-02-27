const db = require('../../db');

class LiveExamSubmissionService {
  async getExamWithQuestions(lessonId, examId) {
    const result = await db.query(
      `SELECT id, lesson_id, questions, published_at, visibility_countdown_seconds, time_limit_minutes
       FROM live_exams
       WHERE id = $1 AND lesson_id = $2 AND status = 'published'`,
      [examId, lessonId],
    );
    return result.rows[0] || null;
  }

  async getMySubmission(examId, studentId) {
    const result = await db.query(
      `SELECT id, score, total_questions, correct_count, time_taken_ms, answers, submitted_at, late_submission
       FROM live_exam_submissions
       WHERE exam_id = $1 AND student_id = $2`,
      [examId, studentId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const perQuestionResult = Array.isArray(row.answers) ? row.answers : [];
    return {
      score: row.score,
      totalQuestions: row.total_questions,
      correctCount: row.correct_count,
      timeTakenMs: row.time_taken_ms,
      submittedAt: row.submitted_at,
      lateSubmission: !!row.late_submission,
      perQuestionResult,
    };
  }

  async createSubmission(lessonId, examId, studentId, { answers, timeTakenMs }) {
    const existing = await this.getMySubmission(examId, studentId);
    if (existing) {
      throw new Error('Already submitted');
    }
    const exam = await this.getExamWithQuestions(lessonId, examId);
    if (!exam) {
      throw new Error('Exam not found or not published');
    }
    const countdownSec = exam.visibility_countdown_seconds != null ? Number(exam.visibility_countdown_seconds) : 10;
    const timeLimitMin = exam.time_limit_minutes != null && exam.time_limit_minutes > 0 ? Number(exam.time_limit_minutes) : 0;
    let lateSubmission = false;
    if (exam.published_at) {
      const publishedAt = new Date(exam.published_at).getTime();
      const visibleAt = publishedAt + countdownSec * 1000;
      const endAt = visibleAt + timeLimitMin * 60 * 1000;
      const now = Date.now();
      const graceMs = 15000;
      if (now > endAt + graceMs) {
        lateSubmission = true;
      }
    }
    const questions = Array.isArray(exam.questions) ? exam.questions : [];
    const answerMap = answers && typeof answers === 'object' ? answers : {};

    let totalQuestions = questions.length;
    let correctCount = 0;
    const perQuestionResult = [];

    for (const q of questions) {
      const selectedOptionId = answerMap[q.id] || null;
      const correctOptionId = q.correctOptionId || null;
      const isCorrect = !!selectedOptionId && selectedOptionId === correctOptionId;
      if (isCorrect) correctCount += 1;
      perQuestionResult.push({
        questionId: q.id,
        selectedOptionId,
        correctOptionId,
        isCorrect,
      });
    }

    const score = correctCount; // simple: 1 point per correct

    const insert = await db.query(
      `INSERT INTO live_exam_submissions (exam_id, lesson_id, student_id, score, total_questions, correct_count, time_taken_ms, answers, late_submission)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, score, total_questions, correct_count, time_taken_ms, submitted_at, late_submission`,
      [
        examId,
        lessonId,
        studentId,
        score,
        totalQuestions,
        correctCount,
        Math.max(0, parseInt(timeTakenMs, 10) || 0),
        JSON.stringify(perQuestionResult),
        lateSubmission,
      ],
    );

    const submission = insert.rows[0];
    return {
      submission,
      perQuestionResult,
      totalQuestions,
      correctCount,
      score,
      lateSubmission,
    };
  }

  async getLeaderboard(lessonId, examId, limit = 20) {
    const result = await db.query(
      `SELECT s.student_id,
              s.score,
              s.correct_count,
              s.total_questions,
              s.time_taken_ms,
              s.submitted_at,
              COALESCE(sp.name, u.email) AS student_name
       FROM live_exam_submissions s
       JOIN users u ON u.id = s.student_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE s.exam_id = $1 AND s.lesson_id = $2
         AND COALESCE(s.late_submission, false) = false
       ORDER BY s.score DESC, s.time_taken_ms ASC, s.submitted_at ASC
       LIMIT $3`,
      [examId, lessonId, limit],
    );
    return result.rows.map((row, index) => ({
      rank: index + 1,
      studentId: row.student_id,
      studentName: row.student_name || 'Student',
      score: row.score,
      correctCount: row.correct_count,
      totalQuestions: row.total_questions,
      timeTakenMs: row.time_taken_ms,
      submittedAt: row.submitted_at,
    }));
  }
}

module.exports = new LiveExamSubmissionService();

