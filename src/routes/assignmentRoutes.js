const express = require('express');
const router = express.Router();
const multer = require('multer');
const assignmentController = require('../controllers/assignmentController');
const verifyToken = require('../middleware/authMiddleware');
const { requireTeacherPermission } = require('../middleware/teacherPermissionMiddleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.use(verifyToken);

router.post('/submit', upload.array('files', 10), assignmentController.submitAssignment);
router.delete('/cancel', assignmentController.cancelSubmission);
router.get('/status/video/:videoId', assignmentController.getVideoStatus);
router.get('/status/lesson/:lessonId', assignmentController.getLessonStatus);
router.get('/lock-check', assignmentController.getLockStatus);
router.get('/watch-context', assignmentController.getWatchContext);

// Teacher / staff routes
router.get('/teacher/list', requireTeacherPermission('assignments'), assignmentController.listTeacherSubmissions);
router.get('/teacher/:id', requireTeacherPermission('assignments'), assignmentController.getTeacherSubmissionById);
router.get('/teacher/:id/preview', requireTeacherPermission('assignments'), assignmentController.streamSubmissionPreview);
router.post('/teacher/:id/grant', requireTeacherPermission('assignments'), assignmentController.grantSubmission);
router.post('/teacher/:id/decline', requireTeacherPermission('assignments'), assignmentController.declineSubmission);

module.exports = router;
