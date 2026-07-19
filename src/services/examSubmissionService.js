const db = require('../../db');
const examService = require('./examService');

/** Strip correct answers/solutions before sending a question to a student who hasn't submitted yet. */
function sanitizeQuestion(q) {
    if (q.type === 'mcq_n') {
        return {
            id: q.id,
            type: 'mcq_n',
            order: q.order,
            passageText: q.passageText,
            passageImagePath: q.passageImagePath || null,
            subQuestions: (Array.isArray(q.subQuestions) ? q.subQuestions : []).map((sq) => ({
                id: sq.id,
                order: sq.order,
                marks: sq.marks,
                text: sq.text,
                imagePath: sq.imagePath || null,
                options: (Array.isArray(sq.options) ? sq.options : []).map((o) => ({ id: o.id, text: o.text, imagePath: o.imagePath || null })),
            })),
        };
    }
    return {
        id: q.id,
        type: 'mcq',
        order: q.order,
        marks: q.marks,
        text: q.text,
        imagePath: q.imagePath || null,
        options: (Array.isArray(q.options) ? q.options : []).map((o) => ({ id: o.id, text: o.text, imagePath: o.imagePath || null })),
    };
}

/** Flattens mcq + every mcq_n sub-question into one list of gradable leaf items,
 *  carrying full question/option content so results can be rendered in full. */
function flattenGradableQuestions(questions) {
    const leaves = [];
    for (const q of Array.isArray(questions) ? questions : []) {
        if (q.type === 'mcq_n') {
            for (const sq of Array.isArray(q.subQuestions) ? q.subQuestions : []) {
                leaves.push({
                    id: sq.id,
                    marks: Number(sq.marks) > 0 ? Number(sq.marks) : 1,
                    text: sq.text || '',
                    imagePath: sq.imagePath || null,
                    options: (Array.isArray(sq.options) ? sq.options : []).map((o) => ({ id: o.id, text: o.text, imagePath: o.imagePath || null })),
                    correctOptionId: sq.correctOptionId || null,
                    solutionText: sq.solutionText || null,
                    solutionImagePath: sq.solutionImagePath || null,
                    passageText: q.passageText || null,
                    passageImagePath: q.passageImagePath || null,
                });
            }
        } else {
            leaves.push({
                id: q.id,
                marks: Number(q.marks) > 0 ? Number(q.marks) : 1,
                text: q.text || '',
                imagePath: q.imagePath || null,
                options: (Array.isArray(q.options) ? q.options : []).map((o) => ({ id: o.id, text: o.text, imagePath: o.imagePath || null })),
                correctOptionId: q.correctOptionId || null,
                solutionText: q.solutionText || null,
                solutionImagePath: q.solutionImagePath || null,
                passageText: null,
                passageImagePath: null,
            });
        }
    }
    return leaves;
}

function resolveBand(gradingBands, percent) {
    const bands = Array.isArray(gradingBands) ? gradingBands : [];
    const match = bands.find((b) => percent >= Number(b.minPercent) && percent <= Number(b.maxPercent));
    return match || null;
}

class ExamSubmissionService {
    /** Sanitized exam payload for the student to take (never includes correct answers/solutions). */
    getSanitizedExam(exam) {
        return {
            id: exam.id,
            title: exam.title,
            description: exam.description,
            timeLimitMinutes: exam.time_limit_minutes,
            totalMarks: exam.total_marks,
            questions: (Array.isArray(exam.questions) ? exam.questions : []).map(sanitizeQuestion),
        };
    }

    async getOfficialResult(examId, studentId) {
        const result = await db.query(
            `SELECT * FROM exam_submissions WHERE exam_id = $1 AND student_id = $2`,
            [examId, studentId]
        );
        return result.rows[0] || null;
    }

    async getDraft(examId, studentId) {
        const result = await db.query(
            `SELECT * FROM exam_attempt_drafts WHERE exam_id = $1 AND student_id = $2`,
            [examId, studentId]
        );
        return result.rows[0] || null;
    }

    /**
     * Read-only peek at the current state — NEVER creates a draft, so simply
     * loading the exam page does not start the timer. Returns:
     * { phase: 'submitted', submission } | { phase: 'in_progress', draft } | { phase: 'not_started' }
     */
    async peekAttempt(examId, studentId) {
        const official = await this.getOfficialResult(examId, studentId);
        if (official) {
            return { phase: 'submitted', submission: official };
        }
        const existingDraft = await this.getDraft(examId, studentId);
        if (existingDraft) {
            return { phase: 'in_progress', draft: existingDraft };
        }
        return { phase: 'not_started' };
    }

    /** Returns { phase: 'submitted', submission } | { phase: 'in_progress', draft } */
    async startOrResumeAttempt(examId, studentId) {
        const official = await this.getOfficialResult(examId, studentId);
        if (official) {
            return { phase: 'submitted', submission: official };
        }
        const existingDraft = await this.getDraft(examId, studentId);
        if (existingDraft) {
            return { phase: 'in_progress', draft: existingDraft };
        }
        const inserted = await db.query(
            `INSERT INTO exam_attempt_drafts (exam_id, student_id, answers, started_at)
             VALUES ($1, $2, '{}'::jsonb, NOW())
             RETURNING *`,
            [examId, studentId]
        );
        return { phase: 'in_progress', draft: inserted.rows[0] };
    }

    /** A student explicitly starting a fresh retake — discards any old draft and starts the clock over. */
    async restartAttempt(examId, studentId) {
        await db.query(`DELETE FROM exam_attempt_drafts WHERE exam_id = $1 AND student_id = $2`, [examId, studentId]);
        const inserted = await db.query(
            `INSERT INTO exam_attempt_drafts (exam_id, student_id, answers, started_at)
             VALUES ($1, $2, '{}'::jsonb, NOW())
             RETURNING *`,
            [examId, studentId]
        );
        return inserted.rows[0];
    }

    async autosaveAnswers(examId, studentId, answers) {
        const result = await db.query(
            `UPDATE exam_attempt_drafts SET answers = $1, last_saved_at = NOW()
             WHERE exam_id = $2 AND student_id = $3
             RETURNING *`,
            [JSON.stringify(answers && typeof answers === 'object' ? answers : {}), examId, studentId]
        );
        return result.rows[0] || null;
    }

    /**
     * Grades the attempt. If the student has never officially submitted this exam before,
     * this becomes their permanent exam_submissions row. Otherwise it's a practice retake:
     * graded and returned live, but the official record is left untouched.
     */
    async submitAttempt(examId, studentId, answers, timeTakenMs) {
        const exam = await examService.getById(examId);
        if (!exam || exam.status !== 'published') {
            const err = new Error('Exam not found or not published');
            err.status = 404;
            throw err;
        }
        const leaves = flattenGradableQuestions(exam.questions);
        const answerMap = answers && typeof answers === 'object' ? answers : {};

        let score = 0;
        let correctCount = 0;
        let wrongCount = 0;
        let skippedCount = 0;
        const perQuestionResult = [];

        for (const leaf of leaves) {
            const selectedOptionId = answerMap[leaf.id] || null;
            let outcome;
            let marksAwarded = 0;
            if (!selectedOptionId) {
                outcome = 'skipped';
                skippedCount += 1;
            } else if (selectedOptionId === leaf.correctOptionId) {
                outcome = 'correct';
                correctCount += 1;
                marksAwarded = leaf.marks;
                score += leaf.marks;
            } else {
                outcome = 'wrong';
                wrongCount += 1;
            }
            perQuestionResult.push({
                questionId: leaf.id,
                text: leaf.text,
                imagePath: leaf.imagePath,
                options: leaf.options,
                selectedOptionId,
                correctOptionId: leaf.correctOptionId,
                outcome,
                marksAwarded,
                marks: leaf.marks,
                solutionText: leaf.solutionText,
                solutionImagePath: leaf.solutionImagePath,
                passageText: leaf.passageText,
                passageImagePath: leaf.passageImagePath,
            });
        }

        const totalMarks = exam.total_marks || leaves.reduce((sum, l) => sum + l.marks, 0);
        const percent = totalMarks > 0 ? (score / totalMarks) * 100 : 0;
        const band = resolveBand(exam.grading_bands, percent);
        const safeTimeTakenMs = Math.max(0, parseInt(timeTakenMs, 10) || 0);

        const existing = await this.getOfficialResult(examId, studentId);
        let isOfficial = false;
        let submittedAt = new Date().toISOString();
        let startedAt = new Date().toISOString();

        if (!existing) {
            const draft = await this.getDraft(examId, studentId);
            startedAt = draft?.started_at || new Date().toISOString();
            const insert = await db.query(
                `INSERT INTO exam_submissions (exam_id, student_id, answers, score, total_marks, correct_count, wrong_count, skipped_count, time_taken_ms, started_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 RETURNING submitted_at, started_at`,
                [examId, studentId, JSON.stringify(perQuestionResult), score, totalMarks, correctCount, wrongCount, skippedCount, safeTimeTakenMs, startedAt]
            );
            isOfficial = true;
            submittedAt = insert.rows[0].submitted_at;
            startedAt = insert.rows[0].started_at;
        } else {
            submittedAt = new Date().toISOString();
            startedAt = existing.started_at;
        }

        await db.query(`DELETE FROM exam_attempt_drafts WHERE exam_id = $1 AND student_id = $2`, [examId, studentId]);

        return {
            isOfficial,
            score,
            totalMarks,
            correctCount,
            wrongCount,
            skippedCount,
            percent: Math.round(percent * 100) / 100,
            band,
            perQuestionResult,
            timeTakenMs: safeTimeTakenMs,
            submittedAt,
            startedAt,
        };
    }

    /** Teacher view: full graded result (official) with band resolved fresh from current grading_bands. */
    async getResultForDisplay(examId, studentId) {
        const exam = await examService.getById(examId);
        const submission = await this.getOfficialResult(examId, studentId);
        if (!exam || !submission) return null;
        const percent = submission.total_marks > 0 ? (submission.score / submission.total_marks) * 100 : 0;
        const band = resolveBand(exam.grading_bands, percent);
        return {
            score: submission.score,
            totalMarks: submission.total_marks,
            correctCount: submission.correct_count,
            wrongCount: submission.wrong_count,
            skippedCount: submission.skipped_count,
            percent: Math.round(percent * 100) / 100,
            band,
            perQuestionResult: Array.isArray(submission.answers) ? submission.answers : [],
            timeTakenMs: submission.time_taken_ms,
            submittedAt: submission.submitted_at,
        };
    }

    /** Teacher analytics: per-student official results for an exam. */
    async getSubmissionsForExam(examId) {
        const result = await db.query(
            `SELECT s.id, s.student_id, s.score, s.total_marks, s.correct_count, s.wrong_count, s.skipped_count,
                    s.time_taken_ms, s.submitted_at, s.answers,
                    COALESCE(sp.name, u.email) AS student_name, u.email AS student_email
             FROM exam_submissions s
             JOIN users u ON u.id = s.student_id
             LEFT JOIN student_profiles sp ON sp.user_id = u.id
             WHERE s.exam_id = $1
             ORDER BY s.submitted_at DESC`,
            [examId]
        );
        return result.rows;
    }

    /** Teacher analytics: attempt count, average score, band distribution, per-question difficulty. */
    async getAnalytics(examId) {
        const exam = await examService.getById(examId);
        if (!exam) return null;
        const submissions = await this.getSubmissionsForExam(examId);
        const attemptCount = submissions.length;
        const avgScore = attemptCount > 0 ? submissions.reduce((sum, s) => sum + s.score, 0) / attemptCount : 0;
        const avgPercent = exam.total_marks > 0 ? (avgScore / exam.total_marks) * 100 : 0;

        const bandCounts = {};
        for (const s of submissions) {
            const percent = s.total_marks > 0 ? (s.score / s.total_marks) * 100 : 0;
            const band = resolveBand(exam.grading_bands, percent);
            const label = band?.label || 'Unclassified';
            bandCounts[label] = (bandCounts[label] || 0) + 1;
        }

        const leaves = flattenGradableQuestions(exam.questions);
        const wrongTally = {};
        for (const leaf of leaves) wrongTally[leaf.id] = { total: 0, wrong: 0, marks: leaf.marks };
        for (const s of submissions) {
            const perQ = Array.isArray(s.answers) ? s.answers : [];
            for (const r of perQ) {
                if (!wrongTally[r.questionId]) continue;
                wrongTally[r.questionId].total += 1;
                if (r.outcome === 'wrong' || r.outcome === 'skipped') wrongTally[r.questionId].wrong += 1;
            }
        }
        const perQuestionDifficulty = Object.entries(wrongTally).map(([questionId, v]) => ({
            questionId,
            marks: v.marks,
            wrongOrSkippedPercent: v.total > 0 ? Math.round((v.wrong / v.total) * 10000) / 100 : 0,
            attemptedBy: v.total,
        }));

        return {
            attemptCount,
            averageScore: Math.round(avgScore * 100) / 100,
            averagePercent: Math.round(avgPercent * 100) / 100,
            totalMarks: exam.total_marks,
            bandDistribution: bandCounts,
            perQuestionDifficulty,
        };
    }
}

module.exports = new ExamSubmissionService();
