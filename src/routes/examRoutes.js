const express = require('express');
const multer = require('multer');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const examController = require('../controllers/examController');
const examSubmissionController = require('../controllers/examSubmissionController');
const examAnalyticsController = require('../controllers/examAnalyticsController');

const uploadImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
}).single('image');

const uploadTemplate = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
}).single('template');

// Exam media (question/passage/option/solution images) from R2 - public, unauthenticated (unguessable keys)
router.get(/^\/media\/(.+)$/, (req, res, next) => {
    req.params.key = decodeURIComponent(req.params[0]);
    return examController.streamExamMedia(req, res, next);
});

router.use(authMiddleware);

// Teacher: template upload/parse (not exam-scoped, used while building a new exam)
router.post('/parse-template', uploadTemplate, examController.parseTemplate);

// Teacher: exam-scoped management
router.put('/:examId', examController.update);
router.put('/:examId/status', examController.setStatus);
router.delete('/:examId', examController.deleteExam);
router.post('/:examId/images', uploadImage, examController.uploadImage);
router.get('/:examId/submissions', examAnalyticsController.getSubmissions);
router.get('/:examId/analytics', examAnalyticsController.getAnalytics);

// Student: taking an exam
router.get('/:examId/take', examSubmissionController.take);
router.post('/:examId/start', examSubmissionController.start);
router.put('/:examId/autosave', examSubmissionController.autosave);
router.post('/:examId/submit', examSubmissionController.submit);
router.get('/:examId/result', examSubmissionController.getResult);

module.exports = router;
