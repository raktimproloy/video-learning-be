const express = require('express');
const multer = require('multer');
const router = express.Router();
const lessonController = require('../controllers/lessonController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const uploadRecording = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 1024 * 1024 * 1024 },
}).single('recording');

const uploadLesson = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file for notes/assignments
}).any();

// Public/Authenticated routes (specific before generic :id)
router.get('/live/now', authMiddleware, lessonController.getLiveLessons);
router.get('/teacher/live', authMiddleware, lessonController.getTeacherLiveLessons);
router.get('/course/:courseId', authMiddleware, lessonController.getLessonsByCourse);

// Lesson media (notes/assignments files) from R2 - public for img/links
router.get(/^\/media\/(.+)$/, (req, res, next) => {
    req.params.key = decodeURIComponent(req.params[0]);
    return lessonController.streamLessonMedia(req, res, next);
});
router.get('/:id/videos', authMiddleware, lessonController.getLessonVideos);
router.get('/:id/live/token', authMiddleware, lessonController.getLiveToken);
router.put('/:id/live', authMiddleware, lessonController.setLiveAndGetToken);
router.post('/:id/live/save-recording', authMiddleware, uploadRecording, lessonController.saveLiveRecording);
router.get('/:id', authMiddleware, lessonController.getLessonById);

// Teacher only routes (with multer for notes/assignments file uploads)
router.post('/', authMiddleware, requireRole(['teacher']), uploadLesson, lessonController.createLesson);
router.put('/:id', authMiddleware, requireRole(['teacher']), uploadLesson, lessonController.updateLesson);
router.delete('/:id', authMiddleware, requireRole(['teacher']), lessonController.deleteLesson);

module.exports = router;
