const express = require('express');
const multer = require('multer');
const router = express.Router();
const lessonController = require('../controllers/lessonController');
const authMiddleware = require('../middleware/authMiddleware');

const uploadRecording = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 1024 * 1024 * 1024 },
}).single('recording');

// Public/Authenticated routes (specific before generic :id)
router.get('/live/now', authMiddleware, lessonController.getLiveLessons);
router.get('/teacher/live', authMiddleware, lessonController.getTeacherLiveLessons);
router.get('/course/:courseId', authMiddleware, lessonController.getLessonsByCourse);
router.get('/:id/live/token', authMiddleware, lessonController.getLiveToken);
router.put('/:id/live', authMiddleware, lessonController.setLiveAndGetToken);
router.post('/:id/live/save-recording', authMiddleware, uploadRecording, lessonController.saveLiveRecording);
router.get('/:id', authMiddleware, lessonController.getLessonById);

// Teacher only routes
router.post('/', authMiddleware, lessonController.createLesson);
router.put('/:id', authMiddleware, lessonController.updateLesson);
router.delete('/:id', authMiddleware, lessonController.deleteLesson);

module.exports = router;
