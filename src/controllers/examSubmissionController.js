const examService = require('../services/examService');
const examSubmissionService = require('../services/examSubmissionService');
const courseService = require('../services/courseService');

async function ensureEnrolledExam(req, res) {
    if (req.user.role !== 'student') {
        res.status(403).json({ error: 'Students only' });
        return null;
    }
    const exam = await examService.getById(req.params.examId);
    if (!exam || exam.status !== 'published') {
        res.status(404).json({ error: 'Exam not found' });
        return null;
    }
    const enrolled = await courseService.isEnrolled(req.user.id, exam.course_id);
    if (!enrolled) {
        res.status(403).json({ error: 'Access denied' });
        return null;
    }
    return exam;
}

class ExamSubmissionController {
    async take(req, res) {
        try {
            const exam = await ensureEnrolledExam(req, res);
            if (!exam) return;
            const attempt = await examSubmissionService.peekAttempt(exam.id, req.user.id);
            if (attempt.phase === 'submitted') {
                const result = await examSubmissionService.getResultForDisplay(exam.id, req.user.id);
                return res.json({ phase: 'submitted', examTitle: exam.title, result });
            }
            if (attempt.phase === 'in_progress') {
                return res.json({
                    phase: 'in_progress',
                    exam: examSubmissionService.getSanitizedExam(exam),
                    startedAt: attempt.draft.started_at,
                    answers: attempt.draft.answers || {},
                });
            }
            res.json({ phase: 'not_started', exam: examSubmissionService.getSanitizedExam(exam) });
        } catch (error) {
            console.error('Take exam error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async start(req, res) {
        try {
            const exam = await ensureEnrolledExam(req, res);
            if (!exam) return;
            const { restart } = req.body || {};
            const draft = restart
                ? await examSubmissionService.restartAttempt(exam.id, req.user.id)
                : (await examSubmissionService.startOrResumeAttempt(exam.id, req.user.id)).draft
                    || (await examSubmissionService.getDraft(exam.id, req.user.id));
            res.json({
                exam: examSubmissionService.getSanitizedExam(exam),
                startedAt: draft.started_at,
                answers: draft.answers || {},
            });
        } catch (error) {
            console.error('Start exam error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async autosave(req, res) {
        try {
            const exam = await ensureEnrolledExam(req, res);
            if (!exam) return;
            const { answers } = req.body || {};
            const draft = await examSubmissionService.autosaveAnswers(exam.id, req.user.id, answers);
            if (!draft) return res.status(404).json({ error: 'No in-progress attempt found. Start the exam first.' });
            res.json({ success: true, lastSavedAt: draft.last_saved_at });
        } catch (error) {
            console.error('Autosave exam error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async submit(req, res) {
        try {
            const exam = await ensureEnrolledExam(req, res);
            if (!exam) return;
            const { answers, timeTakenMs } = req.body || {};
            const result = await examSubmissionService.submitAttempt(exam.id, req.user.id, answers, timeTakenMs);
            res.status(201).json({ ...result, examTitle: exam.title });
        } catch (error) {
            console.error('Submit exam error:', error);
            res.status(error.status || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    async getResult(req, res) {
        try {
            const exam = await ensureEnrolledExam(req, res);
            if (!exam) return;
            const result = await examSubmissionService.getResultForDisplay(exam.id, req.user.id);
            if (!result) return res.status(404).json({ error: 'No submission found' });
            res.json({ result });
        } catch (error) {
            console.error('Get exam result error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new ExamSubmissionController();
