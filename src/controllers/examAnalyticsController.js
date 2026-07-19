const examService = require('../services/examService');
const examSubmissionService = require('../services/examSubmissionService');

function workspaceTeacherId(req) {
    return req.effectiveTeacherId || req.user.id;
}

async function ensureOwnedExam(req, res) {
    const exam = await examService.getById(req.params.examId);
    if (!exam) {
        res.status(404).json({ error: 'Exam not found' });
        return null;
    }
    if (exam.teacher_id !== workspaceTeacherId(req)) {
        res.status(403).json({ error: 'Not authorized' });
        return null;
    }
    return exam;
}

class ExamAnalyticsController {
    async getSubmissions(req, res) {
        try {
            const exam = await ensureOwnedExam(req, res);
            if (!exam) return;
            const submissions = await examSubmissionService.getSubmissionsForExam(exam.id);
            res.json({ submissions });
        } catch (error) {
            console.error('Get exam submissions error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getAnalytics(req, res) {
        try {
            const exam = await ensureOwnedExam(req, res);
            if (!exam) return;
            const analytics = await examSubmissionService.getAnalytics(exam.id);
            res.json({ analytics });
        } catch (error) {
            console.error('Get exam analytics error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new ExamAnalyticsController();
