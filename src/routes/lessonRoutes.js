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

const uploadLiveMaterial = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for live note/assignment files
}).fields([
    { name: 'file', maxCount: 1 },
]);

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
router.get('/:id/live/chat', authMiddleware, lessonController.getLiveChat);
router.get('/:id/live/materials', authMiddleware, lessonController.getLiveMaterials);
router.get('/:id/live/exams', authMiddleware, lessonController.getLiveExams);
router.get('/:id/live/started-at', authMiddleware, lessonController.getLiveStartedAt);
router.get('/:id/live/viewers', authMiddleware, lessonController.getLiveViewers);
router.get('/:id/live/stats', authMiddleware, lessonController.getLiveStats);
router.put('/:id/live/broadcast-status', authMiddleware, lessonController.setBroadcastStatus);
router.put('/:id/live/session', authMiddleware, lessonController.updateLiveSession);
router.put('/:id/live', authMiddleware, lessonController.setLiveAndGetToken);
router.post('/:id/live/save-recording', authMiddleware, uploadRecording, lessonController.saveLiveRecording);
router.post('/:id/live/watch/join', authMiddleware, lessonController.liveWatchJoin);
router.post('/:id/live/watch/leave', authMiddleware, lessonController.liveWatchLeave);
router.post('/:id/live/watch/heartbeat', authMiddleware, lessonController.liveWatchHeartbeat);
router.post('/:id/live/materials/note', authMiddleware, uploadLiveMaterial, lessonController.addLiveNote);
router.post('/:id/live/materials/assignment', authMiddleware, uploadLiveMaterial, lessonController.addLiveAssignment);
// Pre-live uploads: upload file to R2/local and return path only (no DB insert)
router.post('/:id/live/prelive/materials/note', authMiddleware, uploadLiveMaterial, lessonController.uploadPreliveNoteFile);
router.post('/:id/live/prelive/materials/assignment', authMiddleware, uploadLiveMaterial, lessonController.uploadPreliveAssignmentFile);
router.post('/:id/live/exams', authMiddleware, requireRole(['teacher']), lessonController.saveLiveExam);
router.put('/:id/live/exams/:examId/status', authMiddleware, requireRole(['teacher']), lessonController.setLiveExamStatus);
router.post('/:id/live/exams/:examId/submit', authMiddleware, requireRole(['student']), lessonController.submitLiveExam);
router.get('/:id/live/exams/:examId/leaderboard', authMiddleware, lessonController.getLiveExamLeaderboard);
router.get('/:id', authMiddleware, lessonController.getLessonById);

// Teacher only routes (with multer for notes/assignments file uploads)
router.post('/', authMiddleware, requireRole(['teacher']), uploadLesson, lessonController.createLesson);
router.put('/:id', authMiddleware, requireRole(['teacher']), uploadLesson, lessonController.updateLesson);
router.delete('/:id', authMiddleware, requireRole(['teacher']), lessonController.deleteLesson);

module.exports = router;
